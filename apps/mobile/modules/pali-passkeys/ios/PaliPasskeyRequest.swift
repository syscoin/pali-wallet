import CoreFoundation
import Foundation

enum PaliPasskeyFailure: String, Error {
  case invalid = "PASSKEY_INVALID_REQUEST"
  case unavailable = "PASSKEY_UNAVAILABLE"
  case busy = "PASSKEY_BUSY"
  case cancelled = "PASSKEY_CANCELLED"
  case failed = "PASSKEY_FAILED"
}

enum PaliPasskeyPolicy {
  static let rpId = "paliwallet.com"
  static let origin = "https://paliwallet.com"
  static let timeoutMilliseconds = 90_000
  static let maximumJSONBytes = 65_536

  static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }

  static func bytes(_ value: Any?, minimum: Int, maximum: Int) throws -> Data {
    guard let encoded = value as? String, encoded.utf8.count <= (maximum * 4 + 2) / 3,
      !encoded.isEmpty, encoded.utf8.allSatisfy({
        (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
      }) else { throw PaliPasskeyFailure.invalid }
    let base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    guard let decoded = Data(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)),
      (minimum...maximum).contains(decoded.count), base64URL(decoded) == encoded
      else { throw PaliPasskeyFailure.invalid }
    return decoded
  }

  static func object(_ value: Any?, required: Set<String>, optional: Set<String> = []) throws -> [String: Any] {
    guard let object = value as? [String: Any], required.isSubset(of: Set(object.keys)),
      Set(object.keys).isSubset(of: required.union(optional)) else { throw PaliPasskeyFailure.invalid }
    return object
  }

  static func text(_ value: Any?) throws -> String {
    guard let text = value as? String, !text.isEmpty, text.count <= 80, text.utf8.count <= 320,
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
      else { throw PaliPasskeyFailure.invalid }
    return text
  }

  static func integer(_ value: Any?, equals expected: Int) -> Bool {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return false }
    return value.doubleValue == Double(expected)
  }

  static func descriptorIDs(_ value: Any?, maximum: Int) throws -> [Data] {
    guard let value else { return [] }
    guard let descriptors = value as? [Any], descriptors.count <= maximum else { throw PaliPasskeyFailure.invalid }
    var ids: [Data] = []
    for descriptor in descriptors {
      let fields = try object(descriptor, required: ["type", "id"])
      guard fields["type"] as? String == "public-key" else { throw PaliPasskeyFailure.invalid }
      let id = try bytes(fields["id"], minimum: 1, maximum: 1023)
      guard !ids.contains(id) else { throw PaliPasskeyFailure.invalid }
      ids.append(id)
    }
    return ids
  }
}

struct PaliPasskeyRequest {
  enum Kind { case create, get }
  let kind: Kind
  let challenge: Data
  let credentialIDs: [Data]
  let userID: Data?
  let userName: String?
  let displayName: String?

  init(json: String, kind: Kind) throws {
    guard json.utf8.count <= PaliPasskeyPolicy.maximumJSONBytes,
      let data = json.data(using: .utf8) else { throw PaliPasskeyFailure.invalid }
    let value: Any
    do { value = try JSONSerialization.jsonObject(with: data) }
    catch { throw PaliPasskeyFailure.invalid }
    self.kind = kind
    switch kind {
    case .create:
      let fields = try PaliPasskeyPolicy.object(value,
        required: ["challenge", "rp", "user", "pubKeyCredParams", "authenticatorSelection", "attestation", "timeout"],
        optional: ["excludeCredentials"])
      let rp = try PaliPasskeyPolicy.object(fields["rp"], required: ["id", "name"])
      guard rp["id"] as? String == PaliPasskeyPolicy.rpId else { throw PaliPasskeyFailure.invalid }
      _ = try PaliPasskeyPolicy.text(rp["name"])
      let user = try PaliPasskeyPolicy.object(fields["user"], required: ["id", "name", "displayName"])
      userID = try PaliPasskeyPolicy.bytes(user["id"], minimum: 32, maximum: 32)
      userName = try PaliPasskeyPolicy.text(user["name"])
      displayName = try PaliPasskeyPolicy.text(user["displayName"])
      guard let algorithms = fields["pubKeyCredParams"] as? [Any], algorithms.count == 1 else { throw PaliPasskeyFailure.invalid }
      let algorithm = try PaliPasskeyPolicy.object(algorithms[0], required: ["type", "alg"])
      guard algorithm["type"] as? String == "public-key", PaliPasskeyPolicy.integer(algorithm["alg"], equals: -7)
        else { throw PaliPasskeyFailure.invalid }
      let selection = try PaliPasskeyPolicy.object(fields["authenticatorSelection"],
        required: ["residentKey", "requireResidentKey", "userVerification"], optional: ["authenticatorAttachment"])
      guard selection["residentKey"] as? String == "required", selection["userVerification"] as? String == "required",
        let resident = selection["requireResidentKey"] as? NSNumber, CFGetTypeID(resident) == CFBooleanGetTypeID(), resident.boolValue,
        selection["authenticatorAttachment"] == nil || selection["authenticatorAttachment"] as? String == "platform",
        fields["attestation"] as? String == "none",
        PaliPasskeyPolicy.integer(fields["timeout"], equals: PaliPasskeyPolicy.timeoutMilliseconds)
        else { throw PaliPasskeyFailure.invalid }
      challenge = try PaliPasskeyPolicy.bytes(fields["challenge"], minimum: 32, maximum: 32)
      credentialIDs = try PaliPasskeyPolicy.descriptorIDs(fields["excludeCredentials"], maximum: 32)
    case .get:
      let fields = try PaliPasskeyPolicy.object(value,
        required: ["challenge", "rpId", "userVerification", "timeout"], optional: ["allowCredentials"])
      guard fields["rpId"] as? String == PaliPasskeyPolicy.rpId,
        fields["userVerification"] as? String == "required",
        PaliPasskeyPolicy.integer(fields["timeout"], equals: PaliPasskeyPolicy.timeoutMilliseconds)
        else { throw PaliPasskeyFailure.invalid }
      challenge = try PaliPasskeyPolicy.bytes(fields["challenge"], minimum: 32, maximum: 32)
      credentialIDs = try PaliPasskeyPolicy.descriptorIDs(fields["allowCredentials"], maximum: 1)
      userID = nil
      userName = nil
      displayName = nil
    }
  }
}

/// Synchronous tokens close the gap between JS cancellation and queued native work.
final class PaliPasskeyRequests: @unchecked Sendable {
  final class Ticket: @unchecked Sendable {
    let id: String
    init(id: String) { self.id = id }
  }
  private let lock = NSLock()
  private var reserved: [String: Ticket] = [:]
  private var active: Ticket?
  private var closed = false

  func prepare() throws -> String {
    try lock.withLock {
      guard !closed else { throw PaliPasskeyFailure.unavailable }
      guard reserved.count < 32 else { throw PaliPasskeyFailure.busy }
      let ticket = Ticket(id: UUID().uuidString)
      reserved[ticket.id] = ticket
      return ticket.id
    }
  }

  func claim(_ id: String) throws -> Ticket {
    guard id.utf8.count == 36, UUID(uuidString: id) != nil else { throw PaliPasskeyFailure.cancelled }
    return try lock.withLock {
      guard !closed, let ticket = reserved[id], active !== ticket else { throw PaliPasskeyFailure.cancelled }
      guard active == nil else { reserved.removeValue(forKey: id); throw PaliPasskeyFailure.busy }
      active = ticket
      return ticket
    }
  }

  func isCurrent(_ ticket: Ticket) -> Bool {
    lock.withLock { !closed && active === ticket && reserved[ticket.id] === ticket }
  }

  /// The successful response and cancellation have one atomic settlement point.
  @discardableResult func finish(_ ticket: Ticket) -> Bool {
    lock.withLock {
      let current = !closed && active === ticket && reserved[ticket.id] === ticket
      if active === ticket { active = nil }
      if reserved[ticket.id] === ticket { reserved.removeValue(forKey: ticket.id) }
      return current
    }
  }

  func cancel(_ id: String) -> (cancelled: Bool, active: Ticket?) {
    guard id.utf8.count == 36, UUID(uuidString: id) != nil else { return (false, nil) }
    return lock.withLock {
      guard let ticket = reserved.removeValue(forKey: id) else { return (false, nil) }
      return (true, active === ticket ? ticket : nil)
    }
  }

  func revokeAll(close: Bool = false) -> Ticket? {
    lock.withLock {
      if close { closed = true }
      reserved.removeAll()
      return active
    }
  }
}
