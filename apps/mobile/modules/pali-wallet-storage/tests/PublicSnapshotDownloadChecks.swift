import Foundation

private typealias Outcome = Result<PaliPublicSnapshotResponse, PaliPublicSnapshotDownloadError>

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
        _ = try host.download(pool: pool) { _ in preconditionFailure("invalid pool admitted") }
        preconditionFailure("invalid pool not refused")
      } catch PaliPublicSnapshotDownloadError.invalid {}
    }
    print("registered pool allowlist")

    func run(_ path: String, timeout: TimeInterval = 3) throws -> Outcome {
      let result = Completion()
      _ = try host.downloadLoopback(port: port, path: path, timeout: timeout) { result.accept($0) }
      return result.wait()
    }
    func expectError(_ path: String, _ expected: PaliPublicSnapshotDownloadError, timeout: TimeInterval = 3) throws {
      let outcome = try run(path, timeout: timeout)
      guard case .failure(let error) = outcome, error == expected else {
        preconditionFailure("unexpected outcome for \(path): \(outcome)")
      }
      print("\(path) refused as \(expected.rawValue)")
    }

    try expectError("must-not-hit", .timedOut, timeout: 0)

    let exact = try run("exact").get()
    precondition(exact.status == 200 && exact.bytes.count == 2 * 1024 * 1024 && exact.bytes.allSatisfy { $0 == 0x61 })
    print("exact 2 MiB chunked identity response")
    let progress = try run("progress").get()
    precondition(progress.status == 202 && progress.bytes.count == 4096 && progress.bytes.allSatisfy { $0 == 0x62 })
    print("exact 4 KiB progress response and absent cookies from prior reply")
    try expectError("oversize-length", .tooLarge)
    try expectError("oversize-progress", .tooLarge)
    try expectError("oversize-chunked", .tooLarge)
    try expectError("encoded", .invalid)
    try expectError("redirect", .unavailable)
    try expectError("challenge", .unavailable)
    try expectError("partial", .unavailable)
    try expectError("truncated", .unavailable)

    let cancelled = Completion()
    let held = try host.downloadLoopback(port: port, path: "held", timeout: 3) { cancelled.accept($0) }
    Thread.sleep(forTimeInterval: 0.1)
    do {
      _ = try host.downloadLoopback(port: port, path: "must-not-hit", timeout: 3) { _ in
        preconditionFailure("second concurrent producer admitted")
      }
      preconditionFailure("process slot not held")
    } catch PaliPublicSnapshotDownloadError.busy {}
    held.cancel()
    held.cancel()
    guard case .failure(.cancelled) = cancelled.wait() else { preconditionFailure("cancelled body delivered") }
    let reopened = try run("reopened").get()
    precondition(reopened.status == 200 && reopened.bytes == Data("again".utf8))
    held.cancel()
    precondition(cancelled.count == 1)
    print("busy slot, one cancellation acknowledgement, safe next admission")

    try expectError("deadline", .timedOut, timeout: 0.2)
    let afterDeadline = try run("after-deadline").get()
    precondition(afterDeadline.bytes == Data("again".utf8))
    print("deadline drained before next operation")
  }
}
