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
  static func main() throws {
    let port = UInt16(CommandLine.arguments[1])!
    let host = PaliPublicSnapshotDownloader.shared

    for pool in ["eth-0.1", "eth-1", "eth-10", "eth-100"] {
      precondition(PaliPublicSnapshotDownloader.endpoint(for: pool)?.absoluteString ==
        "https://sysnode.info/api/privacy/v1/pools/\(pool)/snapshot")
    }
    for pool in ["eth-0.10", "../eth-1", "eth-1?x=y", "ETH-1", ""] {
      precondition(PaliPublicSnapshotDownloader.endpoint(for: pool) == nil)
      do {
        _ = try host.prepare(pool: pool) { _ in preconditionFailure("invalid pool admitted") }
        preconditionFailure("invalid pool not refused")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }
    print("registered pool allowlist")

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
    let held = try host.prepareLoopback(port: port, path: "held", timeout: 3) { cancelled.accept($0) }
    held.start()
    held.start()
    Thread.sleep(forTimeInterval: 0.1)
    do {
      _ = try host.prepareLoopback(port: port, path: "must-not-hit", timeout: 3) { _ in
        preconditionFailure("second concurrent producer admitted")
      }
      preconditionFailure("process slot not held")
    } catch PaliPublicSnapshotDownloadError.busy {}
    held.cancel()
    held.cancel()
    guard case .failure(.cancelled) = cancelled.wait() else { preconditionFailure("cancelled body delivered") }
    func checkSmall(_ path: String) throws {
      let (handle, outcome) = try run(path)
      try outcome.get()
      try checkBody(handle, status: 200, count: 5) { _, _ in Data("again".utf8) }
    }
    try checkSmall("reopened")
    held.cancel()
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
