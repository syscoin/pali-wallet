import CryptoKit
import Foundation
@preconcurrency import LocalAuthentication
import Security
import UIKit
import ExpoModulesCore

private struct PaliCredentialCopy {
  let unlock: String
  let authorize: String
}
private func credentialCopy(_ language: String) throws -> PaliCredentialCopy {
  switch language {
  case "en": return PaliCredentialCopy(unlock: "Unlock Pali Wallet", authorize: "Authorize access to Pali Wallet")
  case "es": return PaliCredentialCopy(unlock: "Desbloquear Pali Wallet", authorize: "Autorizar el acceso a Pali Wallet")
  case "pt": return PaliCredentialCopy(unlock: "Desbloquear a Pali Wallet", authorize: "Autorizar o acesso à Pali Wallet")
  case "fr": return PaliCredentialCopy(unlock: "Déverrouiller Pali Wallet", authorize: "Autoriser l’accès à Pali Wallet")
  case "de": return PaliCredentialCopy(unlock: "Pali Wallet entsperren", authorize: "Zugriff auf Pali Wallet erlauben")
  case "zh": return PaliCredentialCopy(unlock: "解锁 Pali Wallet", authorize: "授权访问 Pali Wallet")
  case "ja": return PaliCredentialCopy(unlock: "Pali Walletのロックを解除", authorize: "Pali Walletへのアクセスを許可")
  case "ko": return PaliCredentialCopy(unlock: "Pali Wallet 잠금 해제", authorize: "Pali Wallet 접근 허용")
  case "ru": return PaliCredentialCopy(unlock: "Разблокировать Pali Wallet", authorize: "Разрешить доступ к Pali Wallet")
  default: throw PaliCredentialError.unavailable
  }
}

private let credentialService = "org.pali.mobile.protected-vault.v1"
private let credentialQueue = DispatchQueue(label: "org.paliwallet.credential", qos: .userInitiated)

struct PaliCredentialBinding: Sendable {
  let value: String
  let account: String
  init(_ value: String) throws {
    let pattern = #"^\[1,"[0-9a-f]{32}","[0-9a-f]{64}","[0-9a-f]{64}","[0-9a-f]{32}"\]$"#
    guard value.utf8.count < 256, value.range(of: pattern, options: .regularExpression) != nil else { throw PaliCredentialError.unavailable }
    self.value = value
    self.account = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: credentialService,
    kSecAttrAccount as String: account, kSecAttrSynchronizable as String: false] }
}

enum PaliCredentialError: Error { case unavailable, missing, cancelled, userCancelled }
private func credentialForeground() -> Bool {
  if Thread.isMainThread { return UIApplication.shared.applicationState == .active }
  return DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
}
private func validCredentialSecret(_ bytes: Data) -> Bool {
  guard bytes.count == 71, bytes.prefix(7).elementsEqual("Pali#1:".utf8) else { return false }
  return bytes.dropFirst(7).allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}
private func rejectCredential(_ promise: Promise, _ error: Error) {
  let code: String
  switch error as? PaliCredentialError {
  case .missing: code = "CREDENTIAL_MISSING"
  case .cancelled: code = "CREDENTIAL_CANCELLED"
  case .userCancelled: code = "CREDENTIAL_USER_CANCELLED"
  default: code = "CREDENTIAL_UNAVAILABLE"
  }
  promise.reject(code, "Device authorization unavailable")
}

final class PaliCredentialOwner: @unchecked Sendable {
  private let lock = NSLock()
  private var closed = false
  private var active: PaliCredentialRequest?
  func admit(_ request: PaliCredentialRequest) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !closed, active == nil else { return false }
    active = request; return true
  }
  func current(_ request: PaliCredentialRequest) -> Bool {
    lock.lock(); defer { lock.unlock() }; return !closed && active === request
  }
  func finish(_ request: PaliCredentialRequest) -> Bool? {
    lock.lock(); defer { lock.unlock() }
    guard let permitted = request.claimCompletion() else { return nil }
    let valid = !closed && active === request && permitted
    if active === request { active = nil }
    return valid
  }
  func isAuthenticating() -> Bool {
    lock.lock(); defer { lock.unlock() }; return !closed && active?.isAuthenticating() == true
  }
  func cancel(binding: String? = nil) {
    lock.lock(); let request = active; lock.unlock()
    if binding == nil || request?.binding?.value == binding { request?.cancel() }
  }
  func close() { lock.lock(); closed = true; let request = active; lock.unlock(); request?.cancel() }
  func capabilities(_ raw: String?) throws -> [String: Any] {
    let context = LAContext(); defer { context.invalidate() }
    var error: NSError?
    let ready = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    var present = false
    if let raw {
      var query = try PaliCredentialBinding(raw).query
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      query[kSecReturnAttributes as String] = true
      context.interactionNotAllowed = true
      query[kSecUseAuthenticationContext as String] = context
      var attributes: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &attributes)
      if let fields = attributes as? NSDictionary, fields.count > 32 { throw PaliCredentialError.unavailable }
      attributes = nil
      present = status == errSecSuccess || status == errSecInteractionNotAllowed
    }
    return ["deviceAuth": ready ? "ready" : "missing", "credentialPresent": present]
  }
  func remove(_ raw: String) throws {
    let binding = try PaliCredentialBinding(raw); cancel(binding: raw)
    let status = SecItemDelete(binding.query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw PaliCredentialError.unavailable }
  }
}

/** One immutable reference and one fresh OS access-control context per read/write. */
final class PaliCredentialRequest: SharedObject, @unchecked Sendable {
  let binding: PaliCredentialBinding?
  private let owner: PaliCredentialOwner
  private let authorizationOnly: Bool
  private let copy: PaliCredentialCopy
  private let lock = NSLock()
  private var started = false, cancelled = false, completed = false, nativeWork = false, added = false
  private var accessControl: SecAccessControl?
  private var context: LAContext?
  private var staged: Data?
  private var promise: Promise?
  // These two callbacks are installed/removed only on the main queue.
  private var foregroundObserver: NSObjectProtocol?
  private var foregroundTimeout: DispatchWorkItem?
  init(owner: PaliCredentialOwner, binding: String, language: String, secret: String? = nil, authorizationOnly: Bool = false) throws {
    self.copy = try credentialCopy(language)
    self.owner = owner; self.binding = try PaliCredentialBinding(binding); self.authorizationOnly = authorizationOnly
    if let secret { let bytes = Data(secret.utf8); guard validCredentialSecret(bytes) else { throw PaliCredentialError.unavailable }; staged = bytes }
    super.init()
  }
  /** Public-view authorization never creates or queries a Keychain item. */
  init(viewOwner owner: PaliCredentialOwner, language: String) throws {
    self.copy = try credentialCopy(language)
    self.owner = owner; self.binding = nil; self.authorizationOnly = true
    super.init()
  }
  fileprivate func claimCompletion() -> Bool? {
    lock.lock(); defer { lock.unlock() }
    guard !completed else { return nil }
    completed = true; return !cancelled
  }
  func isAuthenticating() -> Bool {
    lock.lock(); defer { lock.unlock() }; return started && !cancelled && !completed && !nativeWork
  }
  func cancel() {
    lock.lock()
    if completed { lock.unlock(); return }
    cancelled = true
    let context = context, finishNow = started && !nativeWork
    if !started { clear() }
    lock.unlock()
    context?.invalidate()
    if finishNow { finish(nil, PaliCredentialError.cancelled) }
  }
  private func clear() { if staged != nil { staged!.resetBytes(in: 0..<staged!.count); staged = nil } }
  private func check(requireForeground: Bool = true) throws {
    lock.lock(); let live = !cancelled && !completed; lock.unlock()
    guard live, owner.current(self), !requireForeground || credentialForeground() else { throw PaliCredentialError.cancelled }
  }
  private func main(_ work: @escaping @MainActor @Sendable () -> Void) {
    DispatchQueue.main.async(execute: work)
  }
  private func finish(_ secret: String?, _ error: Error?) {
    main { [self] in
      foregroundTimeout?.cancel(); foregroundTimeout = nil
      if let observer = foregroundObserver { NotificationCenter.default.removeObserver(observer); foregroundObserver = nil }
      lock.lock(); let authentication = context; context = nil; accessControl = nil; let shouldRemove = added; let target = promise; promise = nil; clear(); lock.unlock()
      authentication?.invalidate()
      guard let allowed = owner.finish(self) else { return }
      let failure = error ?? ((!allowed || !credentialForeground()) ? PaliCredentialError.cancelled : nil)
      if shouldRemove && failure != nil, let binding { SecItemDelete(binding.query as CFDictionary) }
      guard let target else { return }
      if let failure { rejectCredential(target, failure) } else { target.resolve(secret) }
    }
  }
  private func startRead(_ authentication: LAContext) {
    do { try check() } catch { finish(nil, error); return }
    guard let binding else { finish(nil, nil); return }
    lock.lock()
    guard !cancelled && !completed && !nativeWork else { lock.unlock(); finish(nil, PaliCredentialError.cancelled); return }
    nativeWork = true; lock.unlock()
    credentialQueue.async { [self] in
      var result: CFTypeRef?
      var plaintext: Data?
      var output: String?, failure: Error?
      do {
        try check()
        // This service has one native writer, which always inserts under the
        // fixed policy evaluated by this fresh context. Keychain also enforces
        // the stored item's ACL; opaque ACLs cannot be compared because their
        // private binding state may change when Keychain stores them.
        authentication.interactionNotAllowed = true
        var query = binding.query
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = authentication
        let metadataStatus = SecItemCopyMatching(query as CFDictionary, &result)
        if metadataStatus == errSecItemNotFound { throw PaliCredentialError.missing }
        guard metadataStatus == errSecSuccess, let attributes = result as? NSDictionary, attributes.count <= 32,
          attributes[kSecAttrService as String] as? String == credentialService,
          attributes[kSecAttrAccount as String] as? String == binding.account,
          attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String,
          let access = attributes[kSecAttrAccessControl as String], CFGetTypeID(access as CFTypeRef) == SecAccessControlGetTypeID() else { throw PaliCredentialError.unavailable }
        result = nil; try check()
        if !authorizationOnly {
          query.removeValue(forKey: kSecReturnAttributes as String)
          query[kSecReturnData as String] = true
          let status = SecItemCopyMatching(query as CFDictionary, &result)
          plaintext = result as? Data; result = nil
          try check()
          if status == errSecItemNotFound { throw PaliCredentialError.missing }
          guard status == errSecSuccess, plaintext != nil, validCredentialSecret(plaintext!) else { throw PaliCredentialError.unavailable }
          if let staged { guard staged == plaintext! else { throw PaliCredentialError.unavailable } }
          if staged == nil { output = String(data: plaintext!, encoding: .utf8) }
        }
      } catch { failure = error }
      if plaintext != nil { plaintext!.resetBytes(in: 0..<plaintext!.count) }; plaintext = nil
      lock.lock(); nativeWork = false; lock.unlock()
      finish(output, failure)
    }
  }
  private func authenticated(_ succeeded: Bool, _ error: Error?, _ authentication: LAContext) {
    if succeeded { awaitForeground(authentication) }
    else {
      lock.lock(); let revoked = cancelled; lock.unlock()
      let userCancelled = (error as? LAError)?.code == .userCancel
      finish(nil, revoked ? PaliCredentialError.cancelled : userCancelled ? PaliCredentialError.userCancelled : PaliCredentialError.unavailable)
    }
  }
  private func awaitForeground(_ authentication: LAContext) {
    main { [self] in
      do { try check(requireForeground: false) } catch { finish(nil, error); return }
      if UIApplication.shared.applicationState == .active { startRead(authentication); return }
      guard UIApplication.shared.applicationState == .inactive else { finish(nil, PaliCredentialError.cancelled); return }
      foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        if let observer = self.foregroundObserver { NotificationCenter.default.removeObserver(observer); self.foregroundObserver = nil }
        self.foregroundTimeout?.cancel(); self.foregroundTimeout = nil
        self.startRead(authentication)
      }
      let timeout = DispatchWorkItem { [weak self] in self?.finish(nil, PaliCredentialError.cancelled) }
      foregroundTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
    }
  }
  func run(_ promise: Promise) {
    lock.lock(); let begin = !started && !cancelled; if begin { started = true; nativeWork = true; self.promise = promise }; lock.unlock()
    guard begin, credentialForeground(), owner.admit(self) else {
      if begin { lock.lock(); nativeWork = false; clear(); lock.unlock() }
      rejectCredential(promise, PaliCredentialError.cancelled); return
    }
    let authentication = LAContext()
    authentication.touchIDAuthenticationAllowableReuseDuration = 0
    authentication.localizedReason = binding == nil ? copy.unlock : copy.authorize
    lock.lock(); context = authentication; lock.unlock()
    credentialQueue.async { [self] in
      do {
        try check()
        guard let binding else {
          lock.lock(); nativeWork = false; lock.unlock()
          authentication.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: authentication.localizedReason) { [self] succeeded, error in
            authenticated(succeeded, error, authentication)
          }
          return
        }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &error) else { throw PaliCredentialError.unavailable }
        if let staged {
          var insertion = binding.query; insertion[kSecAttrAccessControl as String] = access; insertion[kSecValueData as String] = staged
          guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { throw PaliCredentialError.unavailable }
          lock.lock(); added = true; lock.unlock()
        }
        try check()
        lock.lock(); accessControl = access; nativeWork = false; lock.unlock()
        authentication.evaluateAccessControl(access, operation: .useItem, localizedReason: authentication.localizedReason) { [self] succeeded, error in
          authenticated(succeeded, error, authentication)
        }
      } catch { lock.lock(); nativeWork = false; lock.unlock(); finish(nil, error) }
    }
  }
  override func sharedObjectDidRelease() { cancel() }
}
