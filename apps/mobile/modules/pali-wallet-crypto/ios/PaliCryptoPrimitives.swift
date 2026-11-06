import Foundation
import CryptoKit
import CommonCrypto
import Security

enum PaliCryptoFailure: Error { case invalidInput, operational, closed }
enum PaliGcmResult { case authenticated(Data), authenticationRejected }

/// Stateless calls to platform cryptography. No algorithm implementation lives here.
enum PaliCryptoPrimitives {
  static let maxGcmData = 8 * 1024 * 1024
  static let maxDigestData = 1_048_576
  static let maxParameter = 65_536

  static func random(_ count: Int) throws -> Data {
    guard (0...65_536).contains(count) else { throw PaliCryptoFailure.invalidInput }
    var output = Data(count: count)
    if count == 0 { return output }
    let status = output.withUnsafeMutableBytes { bytes in
      SecRandomCopyBytes(kSecRandomDefault, count, bytes.baseAddress!)
    }
    guard status == errSecSuccess else { throw PaliCryptoFailure.operational }
    return output
  }

  static func digest(_ data: Data) throws -> Data {
    guard data.count <= maxDigestData else { throw PaliCryptoFailure.invalidInput }
    return Data(SHA256.hash(data: data))
  }

  static func signHmacSha512(_ key: Data, _ data: Data) throws -> Data {
    guard !key.isEmpty, key.count <= 4_096, data.count <= maxDigestData else {
      throw PaliCryptoFailure.invalidInput
    }
    return Data(HMAC<SHA512>.authenticationCode(for: data, using: SymmetricKey(data: key)))
  }

  static func pbkdf2(_ password: Data, _ salt: Data, _ iterations: Int, _ hash: String, _ length: Int) throws -> Data {
    guard password.count <= 4_096, salt.count <= maxParameter,
          (1...2_000_000).contains(iterations), (1...64).contains(length),
          hash == "SHA-256" || hash == "SHA-512" else { throw PaliCryptoFailure.invalidInput }
    var output = Data(count: length)
    let prf = hash == "SHA-512" ? CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA512) : CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256)
    let status = password.withUnsafeBytes { passwordBytes in
      salt.withUnsafeBytes { saltBytes in
        output.withUnsafeMutableBytes { outputBytes in
          CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
            passwordBytes.bindMemory(to: Int8.self).baseAddress, password.count,
            saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
            prf, UInt32(iterations), outputBytes.bindMemory(to: UInt8.self).baseAddress, length)
        }
      }
    }
    guard status == kCCSuccess else {
      output.resetBytes(in: output.startIndex..<output.endIndex)
      throw PaliCryptoFailure.operational
    }
    return output
  }

  static func hkdf(_ input: Data, _ salt: Data, _ info: Data, _ length: Int) throws -> Data {
    guard !input.isEmpty, input.count <= 4_096, salt.count <= maxParameter,
          info.count <= maxParameter, (1...64).contains(length) else { throw PaliCryptoFailure.invalidInput }
    let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: input), salt: salt, info: info, outputByteCount: length)
    return key.withUnsafeBytes { Data($0) }
  }

  private static func validateGcm(_ key: Data, _ iv: Data, _ aad: Data, _ count: Int, decrypt: Bool) throws {
    guard key.count == 32, iv.count == 12, aad.count <= maxParameter,
          count >= (decrypt ? 16 : 0), count <= maxGcmData + (decrypt ? 16 : 0)
    else { throw PaliCryptoFailure.invalidInput }
  }

  static func encrypt(_ key: Data, _ iv: Data, _ aad: Data, _ plaintext: Data) throws -> Data {
    try validateGcm(key, iv, aad, plaintext.count, decrypt: false)
    let nonce = try AES.GCM.Nonce(data: iv)
    let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: nonce, authenticating: aad)
    return box.ciphertext + box.tag
  }

  static func decrypt(_ key: Data, _ iv: Data, _ aad: Data, _ ciphertext: Data) throws -> PaliGcmResult {
    try validateGcm(key, iv, aad, ciphertext.count, decrypt: true)
    // Construction failures are operational. Only open's explicit authentication
    // error becomes the typed rejection consumed by the JavaScript boundary.
    let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv),
      ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
    do {
      return .authenticated(try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad))
    } catch CryptoKitError.authenticationFailure {
      return .authenticationRejected
    }
  }
}
