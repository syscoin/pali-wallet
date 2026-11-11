import AuthenticationServices
import Foundation
import UIKit

/// One delegate owns one controller and its real presenting window. It is never reused.
@available(iOS 15.0, *)
@MainActor
final class PaliPasskeyCeremony: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  private let request: PaliPasskeyRequest
  private let ticket: PaliPasskeyRequests.Ticket
  private let requests: PaliPasskeyRequests
  private let window: UIWindow
  private let scene: UIWindowScene
  private weak var presenter: UIViewController?
  private let controller: ASAuthorizationController
  private var completion: ((Result<String, PaliPasskeyFailure>) -> Void)?
  private var pendingResponse: String?
  private var timeout: DispatchWorkItem?
  private var backgroundObserver: NSObjectProtocol?
  private var sceneObserver: NSObjectProtocol?
  private var appActiveObserver: NSObjectProtocol?
  private var sceneActiveObserver: NSObjectProtocol?

  init(request: PaliPasskeyRequest, ticket: PaliPasskeyRequests.Ticket, requests: PaliPasskeyRequests,
       presenter: UIViewController, completion: @escaping (Result<String, PaliPasskeyFailure>) -> Void) throws {
    guard UIApplication.shared.applicationState == .active, let window = presenter.viewIfLoaded?.window,
      !window.isHidden, window.isKeyWindow, let scene = window.windowScene, scene.activationState == .foregroundActive
      else { throw PaliPasskeyFailure.unavailable }
    self.request = request
    self.ticket = ticket
    self.requests = requests
    self.window = window
    self.scene = scene
    self.presenter = presenter
    self.completion = completion
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: PaliPasskeyPolicy.rpId)
    let authorizationRequest: ASAuthorizationRequest
    switch request.kind {
    case .create:
      guard let name = request.userName, let userID = request.userID else { throw PaliPasskeyFailure.invalid }
      let registration = provider.createCredentialRegistrationRequest(challenge: request.challenge, name: name, userID: userID)
      registration.displayName = request.displayName
      registration.userVerificationPreference = .required
      registration.attestationPreference = .none
      // Platform credentials are resident passkeys; Apple's platform API uses ES256.
      // Older systems cannot enforce exclusions, so never silently drop them.
      if !request.credentialIDs.isEmpty {
        guard #available(iOS 17.4, *) else { throw PaliPasskeyFailure.unavailable }
        registration.excludedCredentials = request.credentialIDs.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
      }
      authorizationRequest = registration
    case .get:
      let assertion = provider.createCredentialAssertionRequest(challenge: request.challenge)
      assertion.userVerificationPreference = .required
      assertion.allowedCredentials = request.credentialIDs.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
      authorizationRequest = assertion
    }
    controller = ASAuthorizationController(authorizationRequests: [authorizationRequest])
    super.init()
    controller.delegate = self
    controller.presentationContextProvider = self
  }

  func start() {
    guard requests.isCurrent(ticket), anchorIsCurrent(requireActive: true) else { cancel(); return }
    let timeout = DispatchWorkItem { [weak self] in self?.cancel() }
    self.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(PaliPasskeyPolicy.timeoutMilliseconds), execute: timeout)
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification,
      object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.cancel() } }
    sceneObserver = NotificationCenter.default.addObserver(forName: UIScene.didDisconnectNotification,
      object: scene, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.cancel() } }
    appActiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
      object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.deliver() } }
    sceneActiveObserver = NotificationCenter.default.addObserver(forName: UIScene.didActivateNotification,
      object: scene, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.deliver() } }
    controller.performRequests()
  }

  func cancel() {
    guard completion != nil else { return }
    // Settle and detach before cancel(), which may synchronously call the delegate.
    finish(.failure(.cancelled))
    if #available(iOS 16.0, *) { controller.cancel() }
  }

  func owns(_ ticket: PaliPasskeyRequests.Ticket) -> Bool { self.ticket === ticket }

  private func anchorIsCurrent(requireActive: Bool) -> Bool {
    guard presenter?.viewIfLoaded?.window === window, !window.isHidden, window.windowScene === scene,
      scene.activationState != .background, scene.activationState != .unattached,
      UIApplication.shared.applicationState != .background else { return false }
    return !requireActive || (UIApplication.shared.applicationState == .active && scene.activationState == .foregroundActive)
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    if self.controller !== controller || !requests.isCurrent(ticket) || !anchorIsCurrent(requireActive: false) { cancel() }
    // This is always the captured host window, never a fabricated fallback window.
    return window
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard self.controller === controller, completion != nil, pendingResponse == nil else { return }
    guard requests.isCurrent(ticket), anchorIsCurrent(requireActive: false) else { cancel(); return }
    do {
      // Public WebAuthn bytes only. A completed system sheet can precede the
      // original scene's activation; keep the owner and deadline until then.
      pendingResponse = try responseJSON(authorization.credential)
      deliver()
    }
    catch { finish(.failure(.failed)) }
  }

  private func deliver() {
    guard completion != nil, let pendingResponse else { return }
    guard requests.isCurrent(ticket), anchorIsCurrent(requireActive: false) else { cancel(); return }
    guard anchorIsCurrent(requireActive: true) else { return }
    finish(.success(pendingResponse))
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    guard self.controller === controller, completion != nil else { return }
    let code = (error as NSError).domain == ASAuthorizationError.errorDomain &&
      (error as NSError).code == ASAuthorizationError.canceled.rawValue ? PaliPasskeyFailure.cancelled : .failed
    finish(.failure(code))
  }

  private func finish(_ result: Result<String, PaliPasskeyFailure>) {
    guard let completion else { return }
    self.completion = nil
    pendingResponse = nil
    timeout?.cancel()
    timeout = nil
    if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
    if let sceneObserver { NotificationCenter.default.removeObserver(sceneObserver) }
    if let appActiveObserver { NotificationCenter.default.removeObserver(appActiveObserver) }
    if let sceneActiveObserver { NotificationCenter.default.removeObserver(sceneActiveObserver) }
    backgroundObserver = nil
    sceneObserver = nil
    appActiveObserver = nil
    sceneActiveObserver = nil
    controller.delegate = nil
    controller.presentationContextProvider = nil
    let current = requests.finish(ticket)
    completion(current ? result : .failure(.cancelled))
  }

  private func responseJSON(_ credential: ASAuthorizationCredential) throws -> String {
    let id: Data
    var response: [String: String]
    switch request.kind {
    case .create:
      guard let registration = credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
        let attestation = registration.rawAttestationObject else { throw PaliPasskeyFailure.failed }
      id = registration.credentialID
      response = ["clientDataJSON": try encoded(registration.rawClientDataJSON, minimum: 1, maximum: 16_384),
        "attestationObject": try encoded(attestation, minimum: 1, maximum: 16_384)]
    case .get:
      guard let assertion = credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else { throw PaliPasskeyFailure.failed }
      id = assertion.credentialID
      guard request.credentialIDs.isEmpty || request.credentialIDs.contains(id) else { throw PaliPasskeyFailure.failed }
      response = ["clientDataJSON": try encoded(assertion.rawClientDataJSON, minimum: 1, maximum: 16_384),
        "authenticatorData": try encoded(assertion.rawAuthenticatorData, minimum: 37, maximum: 16_384),
        "signature": try encoded(assertion.signature, minimum: 8, maximum: 72)]
      if !assertion.userID.isEmpty { response["userHandle"] = try encoded(assertion.userID, minimum: 1, maximum: 64) }
    }
    let encodedID = try encoded(id, minimum: 1, maximum: 1023)
    let object: [String: Any] = ["id": encodedID, "rawId": encodedID, "type": "public-key", "response": response]
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    guard data.count <= PaliPasskeyPolicy.maximumJSONBytes, let json = String(data: data, encoding: .utf8)
      else { throw PaliPasskeyFailure.failed }
    return json
  }

  private func encoded(_ data: Data, minimum: Int, maximum: Int) throws -> String {
    guard (minimum...maximum).contains(data.count) else { throw PaliPasskeyFailure.failed }
    return PaliPasskeyPolicy.base64URL(data)
  }
}
