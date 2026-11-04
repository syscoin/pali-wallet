import Foundation

// Fixed classifications only. Unknown values never satisfy the wallet policy.
enum PaliFileProtectionClass: String {
  case complete
  case missing
  case none
  case unlessOpen
  case untilFirstAuthentication
  case unknown

  var satisfiesWalletPolicy: Bool { self == .complete }
}

func classifyPaliFileProtection(_ value: URLFileProtection?) -> PaliFileProtectionClass {
  guard let value else { return .missing }
  if value == URLFileProtection.complete { return .complete }
  if value == URLFileProtection.none { return .none }
  if value == URLFileProtection.completeUnlessOpen { return .unlessOpen }
  if value == URLFileProtection.completeUntilFirstUserAuthentication { return .untilFirstAuthentication }
  return .unknown
}
