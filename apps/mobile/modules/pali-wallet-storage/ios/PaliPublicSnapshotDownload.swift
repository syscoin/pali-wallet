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

struct PaliPublicSnapshotResponse: Sendable {
  let status: Int
  let bytes: Data
}

/// One public GET per process. The slot stays held until Foundation invalidates its session.
final class PaliPublicSnapshotDownloader: @unchecked Sendable {
  static let shared = PaliPublicSnapshotDownloader()
  private let lock = NSLock()
  private var active = false
  private init() {}

  static func endpoint(for pool: String) -> URL? {
    switch pool {
    case "eth-0.1", "eth-1", "eth-10", "eth-100":
      return URL(string: "https://sysnode.info/api/privacy/v1/pools/\(pool)/snapshot")
    default: return nil
    }
  }

  func download(
    pool: String,
    completion: @escaping @Sendable (Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>) -> Void
  ) throws -> PaliPublicSnapshotOperation {
    guard let endpoint = Self.endpoint(for: pool) else { throw PaliPublicSnapshotDownloadError.invalid }
    return try start(endpoint, timeout: 25, completion: completion)
  }

  private func start(
    _ endpoint: URL,
    timeout: TimeInterval,
    completion: @escaping @Sendable (Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>) -> Void
  ) throws -> PaliPublicSnapshotOperation {
    try lock.withLock {
      guard !active else { throw PaliPublicSnapshotDownloadError.busy }
      active = true
    }
    let operation = PaliPublicSnapshotOperation(endpoint, timeout: timeout) { result in
      self.lock.withLock { self.active = false }
      completion(result)
    }
    operation.start()
    return operation
  }

  #if PALI_SNAPSHOT_LOOPBACK
  // Compiled only into the standalone host fixture. App builds accept only registered pools.
  func downloadLoopback(
    port: UInt16, path: String, timeout: TimeInterval,
    completion: @escaping @Sendable (Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>) -> Void
  ) throws -> PaliPublicSnapshotOperation {
    try start(URL(string: "http://127.0.0.1:\(port)/\(path)")!, timeout: timeout, completion: completion)
  }
  #endif
}

/// State for the owned task is protected by the lock. Body and HTTP state belong to its serial delegate queue.
final class PaliPublicSnapshotOperation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let endpoint: URL
  private let timeout: TimeInterval
  private let deadline: DispatchTime
  private let completion: @Sendable (Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>) -> Void
  private let lock = NSLock()
  private var task: URLSessionDataTask?
  private var timer: DispatchWorkItem?
  private var stopped: PaliPublicSnapshotDownloadError?
  private var completed = false

  private var status: Int?
  private var declaredLength: Int?
  private var limit = 0
  private var bytes = Data()
  private var failure: PaliPublicSnapshotDownloadError?
  private var pending: Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>?

  fileprivate init(
    _ endpoint: URL,
    timeout: TimeInterval,
    completion: @escaping @Sendable (Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>) -> Void
  ) {
    self.endpoint = endpoint
    self.timeout = timeout
    self.deadline = .now() + timeout
    self.completion = completion
  }

  fileprivate func start() {
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
    request.httpMethod = "GET"
    request.httpShouldHandleCookies = false
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store, no-cache", forHTTPHeaderField: "Cache-Control")
    request.setValue("no-cache", forHTTPHeaderField: "Pragma")
    request.setValue("PaliWallet", forHTTPHeaderField: "User-Agent")
    let task = session.dataTask(with: request)
    let timer = DispatchWorkItem { [weak self] in self?.stop(.timedOut) }
    let started = lock.withLock {
      self.task = task
      guard DispatchTime.now() < deadline else {
        stopped = .timedOut
        return false
      }
      self.timer = timer
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: deadline, execute: timer)
      task.resume()
      return true
    }
    if !started { session.invalidateAndCancel() }
  }

  func cancel() { stop(.cancelled) }

  private func stop(_ error: PaliPublicSnapshotDownloadError) {
    let active = lock.withLock { () -> URLSessionDataTask? in
      guard !completed, stopped == nil else { return nil }
      stopped = error
      return task
    }
    active?.cancel()
  }

  private func stopReason() -> PaliPublicSnapshotDownloadError? {
    lock.withLock { stopped ?? (DispatchTime.now() >= deadline ? .timedOut : nil) }
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
      guard let http = response as? HTTPURLResponse, http.url?.absoluteString == endpoint.absoluteString,
            http.statusCode == 200 || http.statusCode == 202 else {
        throw PaliPublicSnapshotDownloadError.unavailable
      }
      // Reject content coding at headers. Foundation owns network buffers and delegate chunks.
      if let encoding = http.value(forHTTPHeaderField: "Content-Encoding"), encoding.lowercased() != "identity" {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      limit = http.statusCode == 202 ? 4 * 1024 : 2 * 1024 * 1024
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
    let failure = stopReason() ?? failure
    if let failure { pending = .failure(failure) }
    else if (error as? URLError)?.code == .timedOut { pending = .failure(.timedOut) }
    else if error != nil { pending = .failure(.unavailable) }
    else if let status, declaredLength == nil || declaredLength == bytes.count {
      pending = .success(PaliPublicSnapshotResponse(status: status, bytes: bytes))
    } else { pending = .failure(.invalid) }
    bytes = Data()
    session.finishTasksAndInvalidate()
  }

  func urlSession(_ session: URLSession, didBecomeInvalidWithError error: (any Error)?) {
    let result: Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>? = lock.withLock {
      guard !completed else { return nil }
      completed = true
      timer?.cancel()
      timer = nil
      task = nil
      if let stopped { return .failure(stopped) }
      if DispatchTime.now() >= deadline { return .failure(.timedOut) }
      if error != nil { return .failure(.unavailable) }
      return pending ?? .failure(.unavailable)
    }
    pending = nil
    if let result { completion(result) }
  }
}
