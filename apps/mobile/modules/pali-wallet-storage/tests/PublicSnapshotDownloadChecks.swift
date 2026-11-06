import Foundation

private typealias Outcome = Result<Void, PaliPublicSnapshotDownloadError>

private final class Completion: @unchecked Sendable {
  private let lock = NSLock()
  private let signal = DispatchSemaphore(value: 0)
  private var values: [Outcome] = []

  func accept(_ result: Outcome) {
    lock.withLock { values.append(result) }
    signal.signal()
  }

  func wait() -> Outcome {
    precondition(signal.wait(timeout: .now() + 5) == .success, "operation failed to drain")
    return lock.withLock { values[0] }
  }

  var count: Int { lock.withLock { values.count } }
}

@main
private enum PublicSnapshotDownloadChecks {
  private static func checkAnchorPosts(
    port: UInt16, host: PaliPublicSnapshotDownloader, heldReady: String
  ) throws {
    typealias Anchor = PaliPublicSnapshotAnchor
    let pool = "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936"
    let root = "0x" + String(repeating: "ab", count: 32)
    let block = 9_117_609
    for endpoint in ["http://rpc.example/", "http://127.0.0.1:1234/", "https://user:password@rpc.example/",
                     "https://rpc.example/#fragment", "/relative"] {
      do {
        _ = try Anchor(registeredEndpoint: endpoint, poolAddress: pool, blockNumber: block, root: root)
        preconditionFailure("invalid captured endpoint admitted")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }
    let endpoint = "https://rpc.example/v1/path?route=ethereum"
    _ = try Anchor(registeredEndpoint: endpoint, poolAddress: pool, blockNumber: block, root: root)
    for (address, number, value) in [("0xarbitrary", block, root), (pool, 0, root), (pool, block, "0x1")] {
      do {
        _ = try Anchor(registeredEndpoint: endpoint, poolAddress: address, blockNumber: number, root: value)
        preconditionFailure("invalid anchor facts admitted")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }

    func prepare(_ path: String, _ read: Anchor.Read, _ id: Int) throws -> (PaliPublicSnapshotOperation, Completion) {
      let anchor = try Anchor.loopback(port: port, path: path, poolAddress: pool, blockNumber: block, root: root)
      let result = Completion()
      let handle = try host.prepareAnchor(anchor, read: read, id: id) { result.accept($0) }
      return (handle, result)
    }

    do {
      _ = try prepare("anchor-must-not-hit", .chainId, 0)
      preconditionFailure("invalid correlation ID admitted")
    } catch PaliPublicSnapshotDownloadError.invalid {}
    let (cancelled, wakeup) = try prepare("anchor-must-not-hit", .chainId, 1)
    cancelled.cancel()
    cancelled.start()
    guard case .failure(.cancelled) = wakeup.wait() else { preconditionFailure("late POST after retirement") }

    let reads: [Anchor.Read] = [.chainId, .block, .nextIndex, .lastRoot, .levels, .denomination, .block, .knownRoot]
    for (index, read) in (reads + reads).enumerated() {
      let id = index + 1
      let (handle, result) = try prepare("anchor/captured?route=eth", read, id)
      handle.start()
      handle.start()
      try result.wait().get()
      let prefix = Data(#"{"jsonrpc":"2.0","id":\#(id),"result":"0x1"}"#.utf8)
      let count = read == .block ? 4 * 1024 * 1024 : 64 * 1024
      let info = try handle.info()
      precondition(info.status == 200 && info.byteCount == count)
      do {
        _ = try host.prepare(pool: "eth-1", serviceOrigin: "https://snapshot.example") { _ in preconditionFailure("GET competed with retained anchor") }
        preconditionFailure("retained anchor did not occupy shared slot")
      } catch PaliPublicSnapshotDownloadError.busy {}
      var position = 0
      while let chunk = try handle.pull() {
        let expected = position == 0 ? prefix : Data()
        precondition(chunk.count == min(count - position, 64 * 1024))
        precondition(chunk.starts(with: expected) && chunk.dropFirst(expected.count).withUnsafeBytes { $0.allSatisfy { $0 == 32 } })
        position += chunk.count
      }
      precondition(position == count && result.count == 1)
    }

    for (path, read, error) in [
      ("scalar-length", Anchor.Read.chainId, PaliPublicSnapshotDownloadError.tooLarge),
      ("block-length", .block, .tooLarge),
      ("scalar-chunked", .knownRoot, .tooLarge),
      ("redirect", .chainId, .unavailable),
      ("challenge", .chainId, .unavailable),
      ("encoded", .chainId, .invalid),
      ("dropped", .chainId, .unavailable),
    ] {
      let (handle, result) = try prepare("anchor/" + path, read, 17)
      handle.start()
      guard case .failure(let actual) = result.wait(), actual == error else {
        preconditionFailure("unexpected anchor failure for \(path)")
      }
    }
    let (held, result) = try prepare("anchor/held", .chainId, 18)
    held.start()
    let waitUntil = DispatchTime.now() + 3
    while !FileManager.default.fileExists(atPath: heldReady) {
      precondition(DispatchTime.now() < waitUntil, "fixture did not receive the held POST")
      Thread.sleep(forTimeInterval: 0.005)
    }
    held.cancel()
    guard case .failure(.cancelled) = result.wait() else { preconditionFailure("active POST did not cancel") }
    do {
      _ = try held.pull()
      preconditionFailure("cancelled POST exposed a body")
    } catch PaliPublicSnapshotDownloadError.cancelled {}
    print("fixed anchor POST wire envelopes, block/scalar caps, one slot, cancellation and refusal")
  }

  static func main() throws {
    let port = UInt16(CommandLine.arguments[1])!
    let host = PaliPublicSnapshotDownloader.shared

    let origins = ["https://snapshot.example", "https://snapshot.example:8443/",
                   "http://localhost:8800", "http://127.0.0.1:8800"]
    for origin in origins {
      for pool in ["eth-0.1", "eth-1", "eth-10", "eth-100"] {
        precondition(PaliPublicSnapshotDownloader.endpoint(for: pool, serviceOrigin: origin)?.absoluteString ==
          origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/privacy/v1/pools/\(pool)/snapshot")
      }
    }
    for pool in ["eth-0.10", "../eth-1", "eth-1?x=y", "ETH-1", ""] {
      precondition(PaliPublicSnapshotDownloader.endpoint(for: pool, serviceOrigin: origins[0]) == nil)
      do {
        _ = try host.prepare(pool: pool, serviceOrigin: origins[0]) { _ in preconditionFailure("invalid pool admitted") }
        preconditionFailure("invalid pool not refused")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }
    for origin in ["", "/relative", "http://snapshot.example", "http://192.168.1.2:8800",
                   "http://[::1]:8800", "https://a:b@snapshot.example", "https://snapshot.example/path",
                   "https://snapshot.example/?key=x", "https://snapshot.example/#x", "javascript:alert(1)",
                   "https://snapshot.example:65536"] {
      precondition(PaliPublicSnapshotDownloader.endpoint(for: "eth-1", serviceOrigin: origin) == nil)
      do {
        _ = try host.prepare(pool: "eth-1", serviceOrigin: origin) { _ in preconditionFailure("invalid origin dispatched") }
        preconditionFailure("invalid service origin not refused")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }
    let selectedOrigin = "http://127.0.0.1:\(port)"
    let bridge = PaliPublicSnapshotBridge()
    let old = try bridge.prepare {
      try host.prepareLoopback(port: port, path: "must-not-hit", timeout: 3, completion: $0)
    }
    let oldReleased = DispatchSemaphore(value: 0)
    try bridge.release(old) { oldReleased.signal() }
    precondition(oldReleased.wait(timeout: .now() + 5) == .success)
    let selectedResult = Completion()
    let selected = try bridge.prepare {
      try host.prepare(pool: "eth-1", serviceOrigin: selectedOrigin, completion: $0)
    }
    try bridge.release(old) {} // Exact stale release cannot retire the next handle.
    try bridge.start(selected) { outcome in
      if case .success(let info) = outcome {
        precondition(info.status == 200 && info.byteCount == 5)
      }
      selectedResult.accept(outcome.map { _ in () })
    }
    try selectedResult.wait().get()
    let selectedBytes = try bridge.pull(selected)
    let selectedEnd = try bridge.pull(selected)
    precondition(selectedBytes == Data("again".utf8) && selectedEnd == nil)
    let selectedReleased = DispatchSemaphore(value: 0)
    try bridge.release(selected) { selectedReleased.signal() }
    precondition(selectedReleased.wait(timeout: .now() + 5) == .success)
    print("explicit service origins and registered pool allowlist")

    try checkAnchorPosts(port: port, host: host, heldReady: CommandLine.arguments[2])

    let qualifiedLimit = 16 * 1024 * 1024
    func prepare(
      _ path: String, timeout: TimeInterval = 3, limit: Int = 2 * 1024 * 1024
    ) throws -> (PaliPublicSnapshotOperation, Completion) {
      let result = Completion()
      let handle = try host.prepareLoopback(port: port, path: path, timeout: timeout, snapshotLimit: limit) {
        result.accept($0)
      }
      return (handle, result)
    }
    func run(
      _ path: String, timeout: TimeInterval = 3, limit: Int = 2 * 1024 * 1024
    ) throws -> (PaliPublicSnapshotOperation, Outcome) {
      let (handle, result) = try prepare(path, timeout: timeout, limit: limit)
      handle.start()
      return (handle, result.wait())
    }
    func expectError(
      _ path: String, _ expected: PaliPublicSnapshotDownloadError,
      timeout: TimeInterval = 3, limit: Int = 2 * 1024 * 1024
    ) throws {
      let (_, outcome) = try run(path, timeout: timeout, limit: limit)
      guard case .failure(let error) = outcome, error == expected else {
        preconditionFailure("unexpected outcome for \(path): \(outcome)")
      }
      print("\(path) refused as \(expected.rawValue)")
    }
    func checkBody(
      _ handle: PaliPublicSnapshotOperation, status: Int, count: Int,
      expected: (Int, Int) -> Data
    ) throws {
      let info = try handle.info()
      precondition(info.status == status && info.byteCount == count)
      var position = 0
      while let chunk = try handle.pull() {
        precondition(chunk.count == min(count - position, 64 * 1024))
        precondition(chunk.count > 0 && chunk == expected(position, chunk.count))
        position += chunk.count
      }
      precondition(position == count)
      do {
        _ = try handle.pull()
        preconditionFailure("retired handle admitted another read")
      } catch PaliPublicSnapshotDownloadError.cancelled {}
    }
    func checkRepeated(_ path: String, status: Int, count: Int, byte: UInt8) throws {
      let (handle, result) = try run(path)
      try result.get()
      try checkBody(handle, status: status, count: count) { _, size in Data(repeating: byte, count: size) }
    }

    do {
      _ = try prepare("must-not-hit", timeout: 0)
      preconditionFailure("expired preparation was admitted")
    } catch PaliPublicSnapshotDownloadError.timedOut {}
    let (beforeStart, notDispatched) = try prepare("must-not-hit")
    do {
      _ = try beforeStart.info()
      preconditionFailure("unstarted handle exposed metadata")
    } catch PaliPublicSnapshotDownloadError.unavailable {}
    beforeStart.cancel()
    beforeStart.start()
    guard case .failure(.cancelled) = notDispatched.wait() else {
      preconditionFailure("pre-dispatch cancellation was lost")
    }

    try checkRepeated("exact", status: 200, count: 2 * 1024 * 1024, byte: 0x61)
    try checkRepeated("progress", status: 202, count: 4096, byte: 0x62)
    try checkRepeated("empty", status: 200, count: 0, byte: 0)
    for (path, size) in [("medium", 6_693_325), ("large", 13_106_047), ("limit", qualifiedLimit)] {
      let (handle, outcome) = try run(path, timeout: 8, limit: qualifiedLimit)
      try outcome.get()
      try checkBody(handle, status: 200, count: size) { position, count in
        var expected = Data()
        for index in stride(from: position, to: position + count, by: 16384) {
          expected.append(Data(repeating: UInt8((index / 16384) % 251), count: min(16384, position + count - index)))
        }
        return expected
      }
      print("\(path) returned \(size) exact bytes in <=64 KiB pulls")
    }
    try expectError("oversize-qualified-length", .tooLarge, limit: qualifiedLimit)
    try expectError("oversize-qualified-chunked", .tooLarge, limit: qualifiedLimit)
    try expectError("oversize-length", .tooLarge)
    try expectError("oversize-progress", .tooLarge)
    try expectError("oversize-chunked", .tooLarge)
    try expectError("encoded", .invalid)
    for path in ["multipart-replace", "multipart"] {
      let (handle, outcome) = try run(path)
      guard case .failure(.invalid) = outcome else {
        preconditionFailure("unexpected outcome for \(path): \(outcome)")
      }
      do {
        _ = try handle.info()
        preconditionFailure("multipart metadata retained")
      } catch PaliPublicSnapshotDownloadError.invalid {}
      do {
        _ = try handle.pull()
        preconditionFailure("multipart body retained")
      } catch PaliPublicSnapshotDownloadError.invalid {}
      print("\(path) refused before retention")
    }
    try expectError("redirect", .unavailable)
    try expectError("challenge", .unavailable)
    try expectError("partial", .unavailable)
    try expectError("truncated", .unavailable)

    let cancelled = Completion()
    let completionEntered = DispatchSemaphore(value: 0)
    let resumeCompletion = DispatchSemaphore(value: 0)
    let held = try bridge.prepare {
      let finish = $0
      return try host.prepareLoopback(port: port, path: "held", timeout: 3) { result in
        completionEntered.signal()
        precondition(resumeCompletion.wait(timeout: .now() + 5) == .success)
        finish(result)
      }
    }
    try bridge.start(held) { outcome in cancelled.accept(outcome.map { _ in () }) }
    Thread.sleep(forTimeInterval: 0.1)
    do {
      _ = try host.prepareLoopback(port: port, path: "must-not-hit", timeout: 3) { _ in
        preconditionFailure("second concurrent producer admitted")
      }
      preconditionFailure("process slot not held")
    } catch PaliPublicSnapshotDownloadError.busy {}
    let heldReleased = DispatchSemaphore(value: 0)
    try bridge.release(held) { heldReleased.signal() }
    bridge.cancelActive()
    precondition(completionEntered.wait(timeout: .now() + 5) == .success)
    precondition(heldReleased.wait(timeout: .now()) == .timedOut, "release was acknowledged before completion")
    do {
      _ = try bridge.prepare {
        try host.prepareLoopback(port: port, path: "must-not-hit", timeout: 3, completion: $0)
      }
      preconditionFailure("replacement admitted before bridge drain")
    } catch PaliPublicSnapshotDownloadError.busy {}
    resumeCompletion.signal()
    guard case .failure(.cancelled) = cancelled.wait() else { preconditionFailure("cancelled body delivered") }
    precondition(heldReleased.wait(timeout: .now() + 5) == .success, "release did not drain")
    func checkSmall(_ path: String) throws {
      let (handle, outcome) = try run(path)
      try outcome.get()
      try checkBody(handle, status: 200, count: 5) { _, _ in Data("again".utf8) }
    }
    try checkSmall("reopened")
    try bridge.release(held) {}
    bridge.close()
    precondition(cancelled.count == 1)
    print("busy slot, one cancellation acknowledgement, safe next admission")

    try expectError("deadline", .timedOut, timeout: 0.2)
    try checkSmall("after-deadline")

    let (retained, ready) = try run("retained")
    try ready.get()
    do {
      _ = try prepare("must-not-hit")
      preconditionFailure("completed but unread body released its slot")
    } catch PaliPublicSnapshotDownloadError.busy {}
    let last = try retained.pull()
    precondition(last == Data("again".utf8))
    do {
      _ = try prepare("must-not-hit")
      preconditionFailure("last chunk released before EOF")
    } catch PaliPublicSnapshotDownloadError.busy {}
    retained.cancel()
    do {
      _ = try retained.info()
      preconditionFailure("released body retained metadata")
    } catch PaliPublicSnapshotDownloadError.cancelled {}
    try checkSmall("after-release")

    let (abandoned, delivered) = try run("abandoned", timeout: 0.8)
    try delivered.get()
    Thread.sleep(forTimeInterval: 1.0)
    do {
      _ = try abandoned.pull()
      preconditionFailure("expired retained body delivered")
    } catch PaliPublicSnapshotDownloadError.timedOut {}
    try checkSmall("after-retained-deadline")

    let entered = DispatchSemaphore(value: 0)
    let resume = DispatchSemaphore(value: 0)
    let late = Completion()
    let delayed = try host.prepareLoopback(port: port, path: "delayed-delivery", timeout: 3) { result in
      entered.signal()
      precondition(resume.wait(timeout: .now() + 5) == .success)
      late.accept(result)
    }
    delayed.start()
    precondition(entered.wait(timeout: .now() + 5) == .success)
    delayed.cancel()
    try checkSmall("after-delayed-delivery")
    resume.signal()
    try late.wait().get()
    do {
      _ = try delayed.pull()
      preconditionFailure("late completion revived retired bytes")
    } catch PaliPublicSnapshotDownloadError.cancelled {}
    print("retained ownership, EOF, explicit release, expiry and stale delivery")
  }
}
