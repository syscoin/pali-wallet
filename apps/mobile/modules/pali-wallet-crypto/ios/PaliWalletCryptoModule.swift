import ExpoModulesCore
import Foundation

private final class PaliCryptoOperationException: Exception {
  override var reason: String { "Native cryptographic operation failed" }
}
private final class WeakKey { weak var key: PaliCryptoKey?; init(_ key: PaliCryptoKey) { self.key = key } }

final class PaliCryptoKey: SharedObject {
  let owner: PaliCryptoContext
  private let kind: String
  private let usages: Set<String>
  private let mutex = NSLock()
  private var material: Data?

  init(owner: PaliCryptoContext, kind: String, usages: [String], material: Data) {
    self.owner = owner; self.kind = kind; self.usages = Set(usages); self.material = Data(material)
    super.init()
  }

  func copyMaterial(owner: PaliCryptoContext, kind: String, usage: String) throws -> Data {
    guard self.owner === owner else { throw PaliCryptoFailure.invalidInput }
    try owner.ensureOpen()
    mutex.lock(); defer { mutex.unlock() }
    guard self.kind == kind, usages.contains(usage), let material else { throw PaliCryptoFailure.invalidInput }
    return Data(material)
  }

  func destroy() {
    mutex.lock(); defer { mutex.unlock() }
    let count = material?.count ?? 0
    material?.resetBytes(in: 0..<count); material = nil
  }
  override func sharedObjectDidRelease() { destroy() }
  override func getAdditionalMemoryPressure() -> Int {
    mutex.lock(); defer { mutex.unlock() }
    return material?.count ?? 0
  }
  deinit { destroy() }
}

final class PaliCryptoContext: SharedObject {
  private let mutex = NSLock()
  private var closed = false
  private var keys: [WeakKey] = []

  func ensureOpen() throws {
    mutex.lock(); defer { mutex.unlock() }
    if closed { throw PaliCryptoFailure.closed }
  }

  func importKey(_ kind: String, _ usages: [String], _ data: Data) throws -> PaliCryptoKey {
    let allowed: Set<String> = kind == "AES-GCM" ? ["encrypt", "decrypt"] : ["deriveBits", "deriveKey"]
    guard ["AES-GCM", "PBKDF2", "HKDF"].contains(kind), !usages.isEmpty,
          usages.count <= 2, Set(usages).count == usages.count,
          Set(usages).isSubset(of: allowed), data.count <= 4_096,
          kind != "AES-GCM" || data.count == 32,
          kind != "HKDF" || !data.isEmpty else { throw PaliCryptoFailure.invalidInput }
    mutex.lock(); defer { mutex.unlock() }
    if closed { throw PaliCryptoFailure.closed }
    keys.removeAll { $0.key == nil }
    let key = PaliCryptoKey(owner: self, kind: kind, usages: usages, material: data)
    keys.append(WeakKey(key))
    return key
  }

  func usingKey<T>(_ key: PaliCryptoKey, kind: String, usage: String, _ body: (Data) throws -> T) throws -> T {
    var material = try key.copyMaterial(owner: self, kind: kind, usage: usage)
    defer { material.resetBytes(in: material.startIndex..<material.endIndex) }
    let result = try body(material)
    try ensureOpen()
    return result
  }

  func close() {
    mutex.lock()
    closed = true
    let live = keys.compactMap { $0.key }; keys.removeAll()
    mutex.unlock()
    live.forEach { $0.destroy() }
  }
  override func sharedObjectDidRelease() { close() }
  deinit { close() }
}

private struct PaliDecryptResponse: Record {
  @Field var status = "authentication-rejected"
  @Field var data: Data? = nil
}

public final class PaliWalletCryptoModule: Module {
  private let queue = DispatchQueue(label: "org.paliwallet.crypto", qos: .userInitiated)

  private func operation<T>(_ body: () throws -> T) throws -> T {
    do { return try body() } catch { throw PaliCryptoOperationException() }
  }

  public func definition() -> ModuleDefinition {
    Name("PaliWalletCrypto")
    Function("info") { ["apiVersion": 1, "implementation": "apple-cryptokit-commoncrypto"] as [String: Any] }
    Function("createContext") { PaliCryptoContext() }
    Class("Key", PaliCryptoKey.self) {}
    Class("Context", PaliCryptoContext.self) {
      Function("close") { (context: PaliCryptoContext) in context.close() }
      Function("importKey") { (context: PaliCryptoContext, kind: String, usages: [String], data: Data) in
        try self.operation { try context.importKey(kind, usages, data) }
      }
      Function("randomBytes") { (context: PaliCryptoContext, count: Int) in
        try self.operation { try context.ensureOpen(); return try PaliCryptoPrimitives.random(count) }
      }
      AsyncFunction("digestSha256") { (context: PaliCryptoContext, data: Data) in
        try self.operation { try context.ensureOpen(); let result = try PaliCryptoPrimitives.digest(data); try context.ensureOpen(); return result }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, iterations: Int, hash: String, length: Int) in
        try self.operation { try context.usingKey(key, kind: "PBKDF2", usage: "deriveBits") {
          try PaliCryptoPrimitives.pbkdf2($0, salt, iterations, hash, length)
        } }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2Key") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, iterations: Int, hash: String, usages: [String]) in
        try self.operation {
          guard hash == "SHA-512" else { throw PaliCryptoFailure.invalidInput }
          var raw = try context.usingKey(key, kind: "PBKDF2", usage: "deriveKey") {
            try PaliCryptoPrimitives.pbkdf2($0, salt, iterations, hash, 32)
          }
          defer { raw.resetBytes(in: raw.startIndex..<raw.endIndex) }
          return try context.importKey("AES-GCM", usages, raw)
        }
      }.runOnQueue(queue)
      AsyncFunction("hkdfBits") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, info: Data, length: Int) in
        try self.operation { try context.usingKey(key, kind: "HKDF", usage: "deriveBits") { try PaliCryptoPrimitives.hkdf($0, salt, info, length) } }
      }.runOnQueue(queue)
      AsyncFunction("hkdfKey") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, info: Data, usages: [String]) in
        try self.operation {
          var raw = try context.usingKey(key, kind: "HKDF", usage: "deriveKey") { try PaliCryptoPrimitives.hkdf($0, salt, info, 32) }
          defer { raw.resetBytes(in: raw.startIndex..<raw.endIndex) }
          return try context.importKey("AES-GCM", usages, raw)
        }
      }.runOnQueue(queue)
      AsyncFunction("encrypt") { (context: PaliCryptoContext, key: PaliCryptoKey, iv: Data, aad: Data, data: Data) in
        try self.operation { try context.usingKey(key, kind: "AES-GCM", usage: "encrypt") { try PaliCryptoPrimitives.encrypt($0, iv, aad, data) } }
      }.runOnQueue(queue)
      AsyncFunction("decrypt") { (context: PaliCryptoContext, key: PaliCryptoKey, iv: Data, aad: Data, data: Data) in
        try self.operation {
          let result = try context.usingKey(key, kind: "AES-GCM", usage: "decrypt") { try PaliCryptoPrimitives.decrypt($0, iv, aad, data) }
          var response = PaliDecryptResponse()
          if case .authenticated(let plaintext) = result { response.status = "authenticated"; response.data = plaintext }
          return response
        }
      }.runOnQueue(queue)
    }
  }
}
