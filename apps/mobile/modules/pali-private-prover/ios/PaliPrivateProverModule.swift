import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit
import WebKit

fileprivate enum ProofFailure: String {
  case readinessTimeout = "ERR_PALI_NATIVE_READINESS_TIMEOUT"
  case jobTimeout = "ERR_PALI_NATIVE_JOB_TIMEOUT"
  case disposalTimeout = "ERR_PALI_NATIVE_DISPOSAL_TIMEOUT"
}

private final class ProofException: Exception {
  private let failure: ProofFailure?
  init(_ failure: ProofFailure? = nil) { self.failure = failure; super.init() }
  override var code: String { failure?.rawValue ?? super.code }
  override var reason: String { "privacy_proof_unavailable" }
}

// Admission remains held until the old document has retired. A missed retirement
// acknowledgement disables this host for the remainder of the app process.
private enum ProofAdmission {
  static let lock = NSLock()
  static var owner: PaliProofHost?
  static var poisoned = false
  static var foreground = true

  static func acquire() throws -> PaliProofHost {
    lock.lock(); defer { lock.unlock() }
    guard foreground, !poisoned, owner == nil else { throw ProofException() }
    let host = PaliProofHost()
    owner = host
    return host
  }

  static func release(_ host: PaliProofHost, clean: Bool) {
    lock.lock(); defer { lock.unlock() }
    guard owner === host else { return }
    poisoned = poisoned || !clean
    owner = nil
  }

  static func background() {
    lock.lock(); foreground = false; let current = owner; lock.unlock()
    current?.close()
  }

  static func resume() { lock.lock(); foreground = true; lock.unlock() }
}

private struct ProofAsset: Decodable {
  let bytes: Int
  let sha256: String
  let mime: String
}

private func readProofResource(_ url: URL, limit: Int) throws -> Data {
  let file = try FileHandle(forReadingFrom: url)
  defer { try? file.close() }
  var data = Data()
  while let chunk = try file.read(upToCount: min(65536, limit + 1 - data.count)), !chunk.isEmpty {
    data.append(chunk)
    guard data.count <= limit else { throw ProofException() }
  }
  return data
}

private final class ProofResources: NSObject, WKURLSchemeHandler {
  let root: URL
  let assets: [String: ProofAsset]
  let host: String
  private let io = DispatchQueue(label: "org.syscoin.pali.proof-assets", qos: .userInitiated)
  // Task ownership and delivery are main-queue confined, including stopped tasks.
  private var tasks: [ObjectIdentifier: (UUID, WKURLSchemeTask)] = [:]
  private var outstandingReads = 0
  private var retired = false

  init(host: String) throws {
    let moduleBundle = Bundle(for: PaliPrivateProverModule.self)
    guard let bundleURL = moduleBundle.url(forResource: "PaliPrivateProver", withExtension: "bundle"),
          let bundle = Bundle(url: bundleURL), let bundleRoot = bundle.resourceURL else { throw ProofException() }
    let root = bundleRoot.appendingPathComponent("pali-private-prover", isDirectory: true)
    let manifest = try readProofResource(root.appendingPathComponent("proof-assets.json"), limit: 16384)
    let assets = try JSONDecoder().decode([String: ProofAsset].self, from: manifest)
    guard !assets.isEmpty, assets.count <= 16, assets["index.html"] != nil else { throw ProofException() }
    self.root = root; self.assets = assets; self.host = host
    super.init()
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    do {
      guard !retired, outstandingReads < 8, let url = task.request.url, url.scheme == "pali-private-prover",
            url.host == host, url.port == nil, url.user == nil, url.password == nil,
            url.query == nil, url.fragment == nil, task.request.httpMethod == "GET" else { throw ProofException() }
      let name = String(url.path.dropFirst())
      guard !name.isEmpty, !name.contains(".."), !name.contains("%"),
            url.absoluteString == "pali-private-prover://\(host)/\(name)",
            let pin = assets[name], pin.bytes > 0, pin.bytes <= 16000000,
            name.range(of: "^[A-Za-z0-9_./-]+$", options: .regularExpression) != nil else { throw ProofException() }
      let key = ObjectIdentifier(task), token = UUID(), file = root.appendingPathComponent(name)
      tasks[key] = (token, task)
      outstandingReads += 1
      io.async {
        let result: (Data, HTTPURLResponse)?
        do {
          let data = try readProofResource(file, limit: pin.bytes)
          let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
          guard data.count == pin.bytes, hash == pin.sha256 else { throw ProofException() }
          let csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src \(name == "index.html" ? "'self'" : "'none'"); connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
          guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": pin.mime, "Content-Length": String(data.count),
            "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"
          ]) else { throw ProofException() }
          result = (data, response)
        } catch { result = nil }
        DispatchQueue.main.async { [weak self] in
          guard let self else { return }
          self.outstandingReads -= 1
          guard !self.retired, let current = self.tasks[key], current.0 == token else { return }
          self.tasks.removeValue(forKey: key)
          if let (data, response) = result {
            current.1.didReceive(response); current.1.didReceive(data); current.1.didFinish()
          } else { current.1.didFailWithError(ProofException()) }
        }
      }
    } catch { task.didFailWithError(ProofException()) }
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    tasks.removeValue(forKey: ObjectIdentifier(task))
  }

  func cancel() {
    retired = true
    tasks.removeAll()
  }

  func retire(_ completion: @escaping () -> Void) {
    cancel()
    // Serial ordering also places every earlier main-queue result before this
    // acknowledgement. No old read/hash result remains held at admission release.
    io.async { DispatchQueue.main.async(execute: completion) }
  }
}

private final class ProofDocument: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
  weak var owner: PaliProofHost?
  let resources: ProofResources
  let view: WKWebView
  let url: URL
  var retiring = false
  private var documentRetired = false
  private var readsDrained = false
  private weak var hostingWindow: UIWindow?
  private weak var hostingScene: UIWindowScene?

  init(owner: PaliProofHost, id: String) throws {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }
      .filter { $0.isKeyWindow && !$0.isHidden && $0.alpha > 0 && $0.rootViewController?.viewIfLoaded != nil }
    guard windows.count == 1, let window = windows.first, let scene = window.windowScene else { throw ProofException() }
    self.owner = owner
    resources = try ProofResources(host: id)
    url = URL(string: "pali-private-prover://\(id)/index.html")!
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.setURLSchemeHandler(resources, forURLScheme: "pali-private-prover")
    view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    super.init()
    hostingWindow = window; hostingScene = scene
    view.isInspectable = false
    view.isUserInteractionEnabled = false
    view.accessibilityElementsHidden = true
    view.isOpaque = false
    view.backgroundColor = .clear
    view.scrollView.backgroundColor = .clear
    view.navigationDelegate = self; view.uiDelegate = self
    view.configuration.userContentController.add(self, name: "PaliPrivateProver")
    // WebKit's iOS activity state requires an actual window. Keep this empty,
    // noninteractive carrier behind the wallet UI through retirement and reads.
    window.insertSubview(view, at: 0)
    guard ownsForegroundWindow else { detach(); throw ProofException() }
  }

  var ownsForegroundWindow: Bool {
    guard let window = hostingWindow, let scene = hostingScene else { return false }
    return UIApplication.shared.applicationState == .active && scene.activationState == .foregroundActive &&
      window.windowScene === scene && window.isKeyWindow && !window.isHidden && window.alpha > 0 && view.window === window
  }

  func load() throws {
    guard ownsForegroundWindow else { throw ProofException() }
    view.load(URLRequest(url: url))
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.webView === view, message.frameInfo.isMainFrame,
          message.frameInfo.securityOrigin.protocol == "pali-private-prover",
          message.frameInfo.securityOrigin.host == resources.host,
          message.frameInfo.securityOrigin.port == 0, view.url == url,
          let json = message.body as? String else { owner?.fail(); return }
    owner?.receive(json)
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let allowed = action.targetFrame?.isMainFrame == true &&
      (retiring ? action.request.url?.absoluteString == "about:blank" : action.request.url == url)
    decisionHandler(allowed ? .allow : .cancel)
    if !allowed { owner?.fail() }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if retiring && webView.url?.absoluteString == "about:blank" {
      documentRetired = true
      finishRetirement()
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { owner?.fail() }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { owner?.fail() }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { owner?.processTerminated() }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }
  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }

  func invoke(_ operation: String, arguments: [String: Any]) {
    if operation == "start" || operation == "startSentry" {
      guard ownsForegroundWindow else { owner?.fail(); return }
    }
    // Fixed program text. Private input is an argument, never evaluated source.
    let program = operation == "start" ? "globalThis.PaliPrivacyProof.start(id, input)" :
      operation == "startSentry" ? "globalThis.PaliPrivacyProof.startSentry(id, input)" :
      operation == "cancelSentry" ? "globalThis.PaliPrivacyProof.cancelSentry(id)" : "globalThis.PaliPrivacyProof.cancel(id)"
    view.callAsyncJavaScript(program, arguments: arguments, in: nil, in: .page) { [weak self] result in
      if case .failure = result { self?.owner?.fail() }
    }
  }

  func retire(contentProcessTerminated: Bool = false) {
    if contentProcessTerminated { documentRetired = true }
    if !retiring {
      retiring = true
      resources.retire { [weak self] in
        self?.readsDrained = true
        self?.finishRetirement()
      }
      if !contentProcessTerminated {
        view.stopLoading()
        view.loadHTMLString("<!doctype html><title></title>", baseURL: nil)
      }
    }
    finishRetirement()
  }

  private func finishRetirement() {
    if documentRetired && readsDrained { owner?.finish(clean: true) }
  }

  func detach() {
    resources.cancel()
    view.configuration.userContentController.removeAllScriptMessageHandlers()
    view.navigationDelegate = nil; view.uiDelegate = nil
    view.stopLoading(); view.removeFromSuperview()
    owner = nil
  }
}

final class PaliProofHost: SharedObject {
  private let mutex = NSLock()
  private var revoked = false
  private var started = false
  // Fields below are confined to the main queue.
  private var document: ProofDocument?
  private var id = ""
  private var input: String?
  private var pending: Promise?
  private var disposals: [Promise] = []
  private var submitted = false
  private var sentry = false
  private var workerRetired = false
  private var retirementRequested = false
  private var finished: Bool?
  private var deadline: DispatchWorkItem?
  private var executionFailure: ProofFailure?

  private var isRevoked: Bool { mutex.lock(); defer { mutex.unlock() }; return revoked }

  func run(id: String, input: String, promise: Promise) {
    runJob(id: id, input: input, sentry: false, promise: promise)
  }

  func runSentry(id: String, input: String, promise: Promise) {
    runJob(id: id, input: input, sentry: true, promise: promise)
  }

  private func runJob(id: String, input: String, sentry: Bool, promise: Promise) {
    mutex.lock()
    let allowed = !revoked && !started
    if allowed { started = true }
    mutex.unlock()
    DispatchQueue.main.async {
      guard allowed, !self.isRevoked, UIApplication.shared.applicationState == .active,
            UUID(uuidString: id)?.uuidString.lowercased() == id,
            id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil,
            input.utf8.count <= (sentry ? 4194304 : 8192) else { promise.reject(ProofException()); self.close(); return }
      if sentry {
        guard let data = input.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(envelope.keys) == ["version", "kind", "job"], envelope["kind"] as? String == "sentry",
              let version = envelope["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              envelope["job"] is [String: Any] else { promise.reject(ProofException()); self.close(); return }
      }
      self.id = id; self.input = input; self.sentry = sentry; self.pending = promise
      do {
        let document = try ProofDocument(owner: self, id: id)
        self.document = document
        try document.load()
        let timeout = DispatchWorkItem { [weak self] in
          guard let self else { return }
          self.fail(self.submitted ? .jobTimeout : .readinessTimeout)
        }
        self.deadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: timeout)
      } catch { self.fail() }
    }
  }

  func close() {
    mutex.lock(); revoked = true; mutex.unlock()
    DispatchQueue.main.async { self.requestRetirement() }
  }

  func dispose(_ promise: Promise) {
    close()
    DispatchQueue.main.async {
      if let clean = self.finished { clean ? promise.resolve() : promise.reject(ProofException(self.executionFailure)) }
      else { self.disposals.append(promise) }
    }
  }

  fileprivate func receive(_ json: String) {
    guard finished == nil, json.utf8.count <= (sentry ? 4194304 : 8192),
          let bytes = json.data(using: .utf8),
          let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          let version = value["version"] as? NSNumber,
          CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
          value["id"] as? String == id,
          let type = value["type"] as? String else { fail(); return }
    let keys = Set(value.keys)
    let basic: Set<String> = sentry ? ["version", "kind", "id", "type"] : ["version", "id", "type"]
    let domain = !sentry || value["kind"] as? String == "sentry"
    if type == "disposed" && keys == basic && domain && isRevoked {
      workerRetired = true; requestRetirement(); return
    }
    guard !isRevoked else { return }
    guard document?.ownsForegroundWindow == true else { fail(); return }
    if type == "ready" && keys == ["version", "id", "type"], !submitted, let input {
      submitted = true; self.input = nil
      document?.invoke(sentry ? "startSentry" : "start", arguments: ["id": id, "input": input])
    } else if !sentry && type == "progress" && keys == ["version", "id", "type", "progress"] && submitted {
      emit(event: "progress", payload: json)
    } else if submitted && domain && ((type == "success" && keys == basic.union(["result"])) ||
                            (type == "error" && keys == basic)) {
      workerRetired = true; deadline?.cancel()
      pending?.resolve(json); pending = nil
    } else { fail() }
  }

  fileprivate func fail(_ failure: ProofFailure? = nil) {
    executionFailure = failure ?? executionFailure
    pending?.reject(ProofException(executionFailure)); pending = nil; input = nil
    close()
  }

  fileprivate func processTerminated() {
    pending?.reject(ProofException()); pending = nil
    close(); requestRetirement(contentProcessTerminated: true)
  }

  private func requestRetirement(contentProcessTerminated: Bool = false) {
    guard finished == nil else { return }
    pending?.reject(ProofException(executionFailure)); pending = nil; input = nil
    if document == nil { finish(clean: true); return }
    if document?.retiring == true {
      if contentProcessTerminated { document?.retire(contentProcessTerminated: true) }
      return
    }
    if !retirementRequested {
      retirementRequested = true
      deadline?.cancel()
      let timeout = DispatchWorkItem { [weak self] in
        guard let self, self.finished == nil else { return }
        self.executionFailure = .disposalTimeout
        self.finish(clean: false)
      }
      deadline = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
    }
    if contentProcessTerminated { document?.retire(contentProcessTerminated: true) }
    else if !submitted || workerRetired { document?.retire() }
    else { document?.invoke(sentry ? "cancelSentry" : "cancel", arguments: ["id": id]) }
  }

  fileprivate func finish(clean: Bool) {
    guard finished == nil else { return }
    finished = clean; deadline?.cancel(); deadline = nil
    input = nil; pending?.reject(ProofException(executionFailure)); pending = nil
    document?.detach(); document = nil
    ProofAdmission.release(self, clean: clean)
    let callbacks = disposals; disposals.removeAll()
    callbacks.forEach { clean ? $0.resolve() : $0.reject(ProofException(executionFailure)) }
  }

  override func sharedObjectDidRelease() { close() }
}

public final class PaliPrivateProverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaliPrivateProver")
    Function("createHost") { try ProofAdmission.acquire() }
    OnAppEntersBackground { ProofAdmission.background() }
    OnAppEntersForeground { ProofAdmission.resume() }
    OnDestroy { ProofAdmission.background() }
    Class("Host", PaliProofHost.self) {
      Function("close") { (host: PaliProofHost) in host.close() }
      AsyncFunction("run") { (host: PaliProofHost, id: String, input: String, promise: Promise) in
        host.run(id: id, input: input, promise: promise)
      }
      AsyncFunction("runSentry") { (host: PaliProofHost, id: String, input: String, promise: Promise) in
        host.runSentry(id: id, input: input, promise: promise)
      }
      AsyncFunction("dispose") { (host: PaliProofHost, promise: Promise) in host.dispose(promise) }
    }
  }
}
