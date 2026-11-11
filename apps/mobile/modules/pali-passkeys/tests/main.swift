import Foundation

// Exercise the exact production parser and token registry with public fixture bytes.
// This does not qualify AuthenticationServices presentation or Expo bridging.

var checks = 0
func check(_ value: @autoclosure () -> Bool) { precondition(value()); checks += 1 }
func rejects(_ expected: PaliPasskeyFailure = .invalid, _ action: () throws -> Void) {
  do { try action(); preconditionFailure("Expected rejection") }
  catch { precondition(error as? PaliPasskeyFailure == expected); checks += 1 }
}
let challenge = PaliPasskeyPolicy.base64URL(Data(repeating: 1, count: 32))
let user = PaliPasskeyPolicy.base64URL(Data(repeating: 2, count: 32))
let descriptor: [String: Any] = ["type": "public-key", "id": PaliPasskeyPolicy.base64URL(Data([1, 2, 3]))]
let create: [String: Any] = ["challenge": challenge, "rp": ["id": "paliwallet.com", "name": "Pali Wallet"],
  "user": ["id": user, "name": "Test", "displayName": "Test"], "pubKeyCredParams": [["type": "public-key", "alg": -7]],
  "authenticatorSelection": ["residentKey": "required", "requireResidentKey": true, "userVerification": "required"],
  "attestation": "none", "timeout": 90000]
let get: [String: Any] = ["challenge": challenge, "rpId": "paliwallet.com", "userVerification": "required", "timeout": 90000,
  "allowCredentials": [descriptor]]
func json(_ value: [String: Any]) -> String { String(data: try! JSONSerialization.data(withJSONObject: value), encoding: .utf8)! }
let parsed = try PaliPasskeyRequest(json: json(create), kind: .create)
check(parsed.challenge == Data(repeating: 1, count: 32)); check(parsed.userID == Data(repeating: 2, count: 32))
let parsedGet = try PaliPasskeyRequest(json: json(get), kind: .get)
check(parsedGet.credentialIDs == [Data([1,2,3])])
for (key, value) in [("rpId", "other.invalid"), ("userVerification", "preferred"), ("challenge", challenge + "=")] {
  var altered = get; altered[key] = value; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
}
var altered = get; altered["timeout"] = true; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
altered = get; altered["timeout"] = 90001; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
altered = get; altered["allowCredentials"] = [descriptor, descriptor]; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
altered = get; altered["challenge"] = "AA"; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
altered = get; altered["origin"] = "https://other.invalid"; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .get) }
for selection: [String: Any] in [
 ["residentKey":"required", "requireResidentKey":1, "userVerification":"required"],
 ["residentKey":"preferred", "requireResidentKey":true, "userVerification":"required"],
 ["residentKey":"required", "requireResidentKey":true, "userVerification":"preferred"]
] { var changed = create; changed["authenticatorSelection"] = selection; rejects { _ = try PaliPasskeyRequest(json: json(changed), kind: .create) } }
altered = create; altered["pubKeyCredParams"] = [["type":"public-key", "alg":-257]]; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .create) }
altered = create; altered["user"] = ["id":user,"name":"bad\nlabel","displayName":"Test"]; rejects { _ = try PaliPasskeyRequest(json: json(altered), kind: .create) }
rejects { _ = try PaliPasskeyRequest(json: String(repeating: " ", count: 65537), kind: .create) }
let owner = PaliPasskeyRequests()
let beforeStart = try owner.prepare(); check(owner.cancel(beforeStart).cancelled)
rejects(.cancelled) { _ = try owner.claim(beforeStart) }
let first = try owner.prepare(); let firstTicket = try owner.claim(first)
check(owner.isCurrent(firstTicket))
let busy = try owner.prepare(); rejects(.busy) { _ = try owner.claim(busy) }
check(owner.cancel(first).active === firstTicket); check(!owner.isCurrent(firstTicket))
let stillBusy = try owner.prepare(); rejects(.busy) { _ = try owner.claim(stillBusy) }
check(!owner.finish(firstTicket))
let second = try owner.prepare(); let secondTicket = try owner.claim(second)
check(owner.isCurrent(secondTicket)); check(owner.finish(secondTicket)); check(!owner.finish(secondTicket))
let bounded = PaliPasskeyRequests(); var reservations: [String] = []
for _ in 0..<32 { reservations.append(try bounded.prepare()) }
rejects(.busy) { _ = try bounded.prepare() }
check(bounded.cancel(reservations[0]).cancelled); _ = try bounded.prepare()
_ = bounded.revokeAll(close: true); rejects(.unavailable) { _ = try bounded.prepare() }
print("{\"swiftPasskeyCases\":\(checks),\"passed\":true,\"deviceQualified\":false}")
