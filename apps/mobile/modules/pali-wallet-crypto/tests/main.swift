import Foundation

// Runs the exact production Swift primitives against public fixture data on a
// macOS host. This does not qualify Expo/Hermes bridging or an iOS device.
func fromHex(_ value: String) -> Data {
  var result = Data(); var index = value.startIndex
  while index < value.endIndex {
    let end = value.index(index, offsetBy: 2)
    result.append(UInt8(value[index..<end], radix: 16)!)
    index = end
  }
  return result
}
func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
func check(_ condition: Bool) { precondition(condition, "Public crypto fixture failed") }
let fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
var cases = 0
for value in fixtures["pbkdf2"] as! [[String: Any]] {
  let derived = try PaliCryptoPrimitives.pbkdf2(fromHex(value["passwordUtf8Hex"] as! String), fromHex(value["saltHex"] as! String), value["iterations"] as! Int, value["hash"] as! String, value["outputBytes"] as! Int)
  check(hex(derived) == value["expectedHex"] as! String); cases += 1
}
let hkdf = fixtures["hkdf"] as! [String: Any]
for pair in [("profileInfoHex", "profileHex"), ("keyInfoHex", "domainKeyHex")] {
  check(hex(try PaliCryptoPrimitives.hkdf(fromHex(hkdf["rootUtf8Hex"] as! String), fromHex(hkdf["saltHex"] as! String), fromHex(hkdf[pair.0] as! String), 32)) == hkdf[pair.1] as! String); cases += 1
}
for value in fixtures["aes"] as! [[String: Any]] {
  let key = fromHex(value["keyHex"] as! String), iv = fromHex(value["ivHex"] as! String)
  let aad = fromHex(value["aadHex"] as? String ?? ""), plaintext = fromHex(value["plaintextHex"] as! String)
  var ciphertext = try PaliCryptoPrimitives.encrypt(key, iv, aad, plaintext)
  check(hex(ciphertext) == value["ciphertextAndTagHex"] as! String); cases += 1
  if case .authenticated(let recovered) = try PaliCryptoPrimitives.decrypt(key, iv, aad, ciphertext) { check(recovered == plaintext) } else { check(false) }
  cases += 1
  ciphertext[ciphertext.startIndex] ^= 1
  if case .authenticationRejected = try PaliCryptoPrimitives.decrypt(key, iv, aad, ciphertext) {} else { check(false) }
  cases += 1
  do { _ = try PaliCryptoPrimitives.decrypt(key, Data(repeating: 0, count: 16), aad, ciphertext); check(false) }
  catch PaliCryptoFailure.invalidInput { cases += 1 }
}
check(hex(try PaliCryptoPrimitives.digest(Data("abc".utf8))) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); cases += 1
let backup = Data(repeating: 0x37, count: 8 * 1024 * 1024)
let backupCiphertext = try PaliCryptoPrimitives.encrypt(Data(repeating: 0, count: 32), Data(repeating: 0, count: 12), Data(repeating: 0x21, count: 64), backup)
check(backupCiphertext.count == backup.count + 16); cases += 1
if case .authenticated(let result) = try PaliCryptoPrimitives.decrypt(Data(repeating: 0, count: 32), Data(repeating: 0, count: 12), Data(repeating: 0x21, count: 64), backupCiphertext) { check(result == backup) } else { check(false) }; cases += 1
do { _ = try PaliCryptoPrimitives.encrypt(Data(repeating: 0, count: 32), Data(repeating: 0, count: 12), Data(), Data(repeating: 0, count: backup.count + 1)); check(false) }
catch PaliCryptoFailure.invalidInput { cases += 1 }
print("{\"swiftPlatformPrimitiveCases\":\(cases),\"passed\":true,\"deviceQualified\":false}")
