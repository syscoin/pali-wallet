import Foundation

/// Internal transport only. Pool validation and chain verification stay in the shared engine.
enum PaliPublicSnapshotDownloadError: String, Error, Sendable {
  case busy = "PUBLIC_SNAPSHOT_BUSY"
  case cancelled = "PUBLIC_SNAPSHOT_CANCELLED"
  case timedOut = "PUBLIC_SNAPSHOT_TIMEOUT"
  case invalid = "PUBLIC_SNAPSHOT_INVALID"
  case tooLarge = "PUBLIC_SNAPSHOT_TOO_LARGE"
  case unavailable = "PUBLIC_SNAPSHOT_UNAVAILABLE"
}

struct PaliPublicSnapshotInfo: Sendable {
  let status: Int
  let byteCount: Int
}

typealias PaliPublicSnapshotCompletion =
  @Sendable (Result<Void, PaliPublicSnapshotDownloadError>) -> Void

/// The trusted host captures the saved RPC endpoint and the selected address from
/// the shared pool registry. Block and root come from its validated public snapshot.
/// This port does not select registrations, validate RPC replies or verify anchors.
struct PaliPublicSnapshotAnchor: Sendable {
  enum Read: String, Sendable {
    case chainId = "eth_chainId"
    case block = "eth_getBlockByNumber"
    // Fixed calldata for the anchor's read-only ABI. Keep parity with verifySnapshotAnchor.
    case nextIndex = "0xfc7e9c6f"
    case lastRoot = "0xba70f757"
    case levels = "0x4ecf518b"
    case denomination = "0x8bca6d16"
    case knownRoot = "0x6d9833e3"
  }

  fileprivate let endpoint: URL
  private let poolAddress: String
  private let blockTag: String
  private let root: String

  init(registeredEndpoint: String, poolAddress: String, blockNumber: Int, root: String) throws {
    guard let parts = URLComponents(string: registeredEndpoint), parts.scheme?.lowercased() == "https",
          parts.host?.isEmpty == false, parts.user == nil, parts.password == nil, parts.fragment == nil,
          let endpoint = parts.url else { throw PaliPublicSnapshotDownloadError.invalid }
    try self.init(endpoint: endpoint, poolAddress: poolAddress, blockNumber: blockNumber, root: root)
  }

  private init(endpoint: URL, poolAddress: String, blockNumber: Int, root: String) throws {
    guard Self.isHex(poolAddress, digits: 40), Self.isHex(root, digits: 64),
          (1...9_007_199_254_740_991).contains(blockNumber) else {
      throw PaliPublicSnapshotDownloadError.invalid
    }
    self.endpoint = endpoint
    self.poolAddress = poolAddress
    self.blockTag = "0x" + String(blockNumber, radix: 16)
    self.root = root
  }

  private static func isHex(_ value: String, digits: Int) -> Bool {
    value.utf8.count == digits + 2 && value.hasPrefix("0x") &&
      value.utf8.dropFirst(2).allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  fileprivate func body(for read: Read, id: Int) throws -> Data {
    guard (1...9_007_199_254_740_991).contains(id) else { throw PaliPublicSnapshotDownloadError.invalid }
    let method: String
    let params: String
    switch read {
    case .chainId:
      method = read.rawValue
      params = "[]"
    case .block:
      method = read.rawValue
      params = #"["\#(blockTag)",false]"#
    default:
      method = "eth_call"
      let data = read == .knownRoot ? read.rawValue + root.dropFirst(2) : read.rawValue
      let tag = read == .knownRoot ? "latest" : blockTag
      params = #"[{"to":"\#(poolAddress)","data":"\#(data)"},"\#(tag)"]"#
    }
    return Data(#"{"jsonrpc":"2.0","id":\#(id),"method":"\#(method)","params":\#(params)}"#.utf8)
  }

  #if PALI_SNAPSHOT_LOOPBACK
  static func loopback(port: UInt16, path: String, poolAddress: String, blockNumber: Int, root: String) throws -> Self {
    try Self(endpoint: URL(string: "http://127.0.0.1:\(port)/\(path)")!,
             poolAddress: poolAddress, blockNumber: blockNumber, root: root)
  }
  #endif
}

/// One public request and retained result per process.
final class PaliPublicSnapshotDownloader: @unchecked Sendable {
  static let shared = PaliPublicSnapshotDownloader()
  private let lock = NSLock()
  private var active: PaliPublicSnapshotOperation?
  private init() {}

  static func endpoint(for pool: String, serviceOrigin: String) -> URL? {
    switch pool {
    case "eth-0.1", "eth-1", "eth-10", "eth-100": break
    default: return nil
    }
    guard var parts = URLComponents(string: serviceOrigin),
          let scheme = parts.scheme?.lowercased(),
          let host = parts.host?.lowercased(), !host.isEmpty,
          scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1"].contains(host)),
          parts.user == nil, parts.password == nil,
          parts.query == nil, parts.fragment == nil,
          parts.path.isEmpty || parts.path == "/",
          parts.port == nil || (0...65535).contains(parts.port!) else { return nil }
    parts.scheme = scheme
    parts.host = host
    parts.path = "/api/privacy/v1/pools/\(pool)/snapshot"
    return parts.url
  }

  /// The caller receives the exact cancellation handle before starting any I/O.
  func prepare(
    pool: String,
    serviceOrigin: String,
    completion: @escaping PaliPublicSnapshotCompletion
  ) throws -> PaliPublicSnapshotOperation {
    guard let endpoint = Self.endpoint(for: pool, serviceOrigin: serviceOrigin) else { throw PaliPublicSnapshotDownloadError.invalid }
    return try reserve(endpoint, timeout: 25, snapshotLimit: 2 * 1024 * 1024, completion: completion)
  }

  /// Same reservation, cancellation and pull protocol as the public GET.
  func prepareAnchor(
    _ anchor: PaliPublicSnapshotAnchor, read: PaliPublicSnapshotAnchor.Read, id: Int,
    completion: @escaping PaliPublicSnapshotCompletion
  ) throws -> PaliPublicSnapshotOperation {
    let body = try anchor.body(for: read, id: id)
    let limit = read == .block ? 4 * 1024 * 1024 : 64 * 1024
    return try reserve(anchor.endpoint, timeout: 25, snapshotLimit: limit, postBody: body, completion: completion)
  }

  private func reserve(
    _ endpoint: URL, timeout: TimeInterval, snapshotLimit: Int, postBody: Data? = nil,
    completion: @escaping PaliPublicSnapshotCompletion
  ) throws -> PaliPublicSnapshotOperation {
    let operation = try lock.withLock {
      guard active == nil else { throw PaliPublicSnapshotDownloadError.busy }
      guard timeout > 0 else { throw PaliPublicSnapshotDownloadError.timedOut }
      let operation = PaliPublicSnapshotOperation(
        endpoint, timeout: timeout, snapshotLimit: snapshotLimit, postBody: postBody, completion: completion
      ) { released in
        self.lock.withLock {
          if self.active === released { self.active = nil }
        }
      }
      active = operation
      return operation
    }
    operation.armDeadline()
    return operation
  }

  #if PALI_SNAPSHOT_LOOPBACK
  // Compiled only into the standalone host fixture. App builds accept only registered pools.
  func prepareLoopback(
    port: UInt16, path: String, timeout: TimeInterval, snapshotLimit: Int = 2 * 1024 * 1024,
    completion: @escaping PaliPublicSnapshotCompletion
  ) throws -> PaliPublicSnapshotOperation {
    try reserve(
      URL(string: "http://127.0.0.1:\(port)/\(path)")!,
      timeout: timeout, snapshotLimit: snapshotLimit, completion: completion
    )
  }
  #endif
}

/// The lock fences the handle and the retained body. HTTP admission is serial on the delegate queue.
final class PaliPublicSnapshotOperation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private enum Phase { case reserved, downloading, ready, retired }
  private static let pullBytes = 64 * 1024

  private let endpoint: URL
  private let timeout: TimeInterval
  private let snapshotLimit: Int
  private let deadline: DispatchTime
  private let isAnchor: Bool
  private let release: @Sendable (PaliPublicSnapshotOperation) -> Void
  private let lock = NSLock()
  private var completion: PaliPublicSnapshotCompletion?
  private var task: URLSessionDataTask?
  private var timer: DispatchWorkItem?
  private var phase = Phase.reserved
  private var stopped: PaliPublicSnapshotDownloadError?
  private var retained: (info: PaliPublicSnapshotInfo, body: Data)?
  private var offset = 0

  // Only the serial URLSession delegate may consume the initial upload stream.
  private var postBody: Data?
  private var status: Int?
  private var declaredLength: Int?
  private var limit = 0
  private var bytes = Data()
  private var failure: PaliPublicSnapshotDownloadError?

  fileprivate init(
    _ endpoint: URL, timeout: TimeInterval, snapshotLimit: Int, postBody: Data?,
    completion: @escaping PaliPublicSnapshotCompletion,
    release: @escaping @Sendable (PaliPublicSnapshotOperation) -> Void
  ) {
    self.endpoint = endpoint
    self.timeout = timeout
    self.snapshotLimit = snapshotLimit
    self.isAnchor = postBody != nil
    self.postBody = postBody
    self.deadline = .now() + timeout
    self.completion = completion
    self.release = release
  }

  fileprivate func armDeadline() {
    let timer = DispatchWorkItem { [weak self] in self?.stop(.timedOut) }
    lock.withLock { self.timer = timer }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: deadline, execute: timer)
  }

  func start() {
    let canStart = lock.withLock {
      guard phase == .reserved, stopReasonLocked() == nil else { return false }
      phase = .downloading
      return true
    }
    if !canStart { return }
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.httpCookieStorage = nil
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.waitsForConnectivity = false
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = timeout

    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .utility
    let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    var request = URLRequest(url: endpoint)
    request.httpMethod = isAnchor ? "POST" : "GET"
    request.httpShouldHandleCookies = false
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store, no-cache", forHTTPHeaderField: "Cache-Control")
    request.setValue("no-cache", forHTTPHeaderField: "Pragma")
    request.setValue("PaliWallet", forHTTPHeaderField: "User-Agent")
    if let postBody {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(String(postBody.count), forHTTPHeaderField: "Content-Length")
    }
    let task = isAnchor ? session.uploadTask(withStreamedRequest: request) : session.dataTask(with: request)
    let started = lock.withLock {
      self.task = task
      guard stopReasonLocked() == nil else { return false }
      task.resume()
      return true
    }
    if !started { session.invalidateAndCancel() }
  }

  /// A completion is only a wakeup. Read metadata through the exact current handle.
  func info() throws -> PaliPublicSnapshotInfo {
    try lock.withLock {
      if let stopped = stopReasonLocked() { throw stopped }
      guard let retained else { throw PaliPublicSnapshotDownloadError.unavailable }
      return retained.info
    }
  }

  /// A fixed-size copy on demand. Exact EOF retires the handle and frees the slot.
  func pull() throws -> Data? {
    let chunk = try lock.withLock { () -> Data? in
      if let stopped = stopReasonLocked() { throw stopped }
      guard let retained else { throw PaliPublicSnapshotDownloadError.unavailable }
      if offset == retained.info.byteCount {
        retireLocked(.cancelled)
        return nil
      }
      let end = min(offset + Self.pullBytes, retained.info.byteCount)
      // Copy the chunk without letting it retain the full response backing.
      let chunk = retained.body.withUnsafeBytes { buffer in
        Data(bytes: buffer.baseAddress!.advanced(by: offset), count: end - offset)
      }
      if let stopped = stopReasonLocked() { throw stopped }
      offset = end
      return chunk
    }
    if chunk == nil { release(self) }
    return chunk
  }

  func cancel() { stop(.cancelled) }

  private func retireLocked(_ error: PaliPublicSnapshotDownloadError) {
    stopped = error
    phase = .retired
    retained = nil
    timer?.cancel()
    timer = nil
  }

  private func takeCompletionLocked() -> PaliPublicSnapshotCompletion? {
    defer { completion = nil }
    return completion
  }

  private func stop(_ error: PaliPublicSnapshotDownloadError) {
    let action = lock.withLock { () -> (URLSessionDataTask?, PaliPublicSnapshotCompletion?, Bool) in
      guard stopped == nil else { return (nil, nil, false) }
      if phase == .downloading {
        stopped = error
        return (task, nil, false)
      }
      retireLocked(error)
      return (nil, takeCompletionLocked(), true)
    }
    action.0?.cancel()
    if action.2 { release(self) }
    action.1?(.failure(error))
  }

  private func stopReasonLocked() -> PaliPublicSnapshotDownloadError? {
    stopped ?? (DispatchTime.now() >= deadline ? .timedOut : nil)
  }

  private func stopReason() -> PaliPublicSnapshotDownloadError? {
    lock.withLock { stopReasonLocked() }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    failure = .unavailable
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    needNewBodyStream completionHandler: @escaping @Sendable (InputStream?) -> Void
  ) {
    // URLSession requests the initial stream and can ask for another after a failure.
    // Vend once, so neither a challenge nor a transport failure can resend it.
    let body = stopReason() == nil ? postBody : nil
    postBody = nil
    completionHandler(body.map { InputStream(data: $0) })
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, needNewBodyStreamFrom offset: Int64,
    completionHandler: @escaping @Sendable (InputStream?) -> Void
  ) {
    guard offset == 0 else { completionHandler(nil); return }
    urlSession(session, task: task, needNewBodyStream: completionHandler)
  }

  private func checkChallenge(
    _ challenge: URLAuthenticationChallenge,
    _ completion: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let protection = challenge.protectionSpace
    if protection.authenticationMethod == NSURLAuthenticationMethodServerTrust && !protection.isProxy() {
      completion(.performDefaultHandling, nil)
    } else {
      completion(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    checkChallenge(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    checkChallenge(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    do {
      if let stopped = stopReason() { throw stopped }
      if let failure { throw failure }
      // Foundation can deliver a response for each multipart part.
      guard status == nil else { throw PaliPublicSnapshotDownloadError.invalid }
      guard let http = response as? HTTPURLResponse, http.url?.absoluteString == endpoint.absoluteString else {
        throw PaliPublicSnapshotDownloadError.unavailable
      }
      let accepted = isAnchor ? (200..<300).contains(http.statusCode) : (http.statusCode == 200 || http.statusCode == 202)
      guard accepted else { throw PaliPublicSnapshotDownloadError.unavailable }
      if http.mimeType?.lowercased().hasPrefix("multipart/") == true {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      // Reject content coding at headers. Foundation owns network buffers and delegate chunks.
      if let encoding = http.value(forHTTPHeaderField: "Content-Encoding"), encoding.lowercased() != "identity" {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      limit = !isAnchor && http.statusCode == 202 ? 4 * 1024 : snapshotLimit
      if let header = http.value(forHTTPHeaderField: "Content-Length") {
        guard !header.isEmpty, header.utf8.allSatisfy({ (48...57).contains($0) }) else {
          throw PaliPublicSnapshotDownloadError.invalid
        }
        guard let length = Int(header), length <= limit else { throw PaliPublicSnapshotDownloadError.tooLarge }
        declaredLength = length
      }
      status = http.statusCode
      // Reserve the maximum accepted length once to avoid geometric copies while accumulating.
      bytes = Data(capacity: declaredLength ?? limit)
      completionHandler(.allow)
    } catch let error as PaliPublicSnapshotDownloadError {
      failure = error
      completionHandler(.cancel)
    } catch {
      failure = .unavailable
      completionHandler(.cancel)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    if let stopped = stopReason() { failure = stopped }
    if failure == nil {
      if status == nil { failure = .invalid }
      else if chunk.count > limit - bytes.count { failure = .tooLarge }
      else if let declaredLength, chunk.count > declaredLength - bytes.count { failure = .invalid }
    }
    if failure != nil {
      bytes = Data()
      dataTask.cancel()
      return
    }
    bytes.append(chunk)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
    if failure == nil {
      if (error as? URLError)?.code == .timedOut { failure = .timedOut }
      else if error != nil { failure = .unavailable }
      else if status == nil || (declaredLength != nil && declaredLength != bytes.count) {
        failure = .invalid
      }
    }
    session.finishTasksAndInvalidate()
  }

  func urlSession(_ session: URLSession, didBecomeInvalidWithError error: (any Error)?) {
    let (notify, refused) = lock.withLock {
      () -> (PaliPublicSnapshotCompletion?, PaliPublicSnapshotDownloadError?) in
      guard phase == .downloading else { return (nil, nil) }
      defer { bytes = Data() }
      task = nil
      let notify = takeCompletionLocked()
      let refusal = stopReasonLocked() ?? failure
      if let status, error == nil, refusal == nil {
        retained = (PaliPublicSnapshotInfo(status: status, byteCount: bytes.count), bytes)
        phase = .ready
        return (notify, nil)
      }
      let reason = refusal ?? .unavailable
      retireLocked(reason)
      return (notify, reason)
    }
    if let refused {
      release(self)
      notify?(.failure(refused))
    } else {
      notify?(.success(()))
    }
  }
}
