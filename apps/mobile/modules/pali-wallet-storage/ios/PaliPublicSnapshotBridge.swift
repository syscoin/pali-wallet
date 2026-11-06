import Foundation

/// One Expo module owns one exact handle through both transport completion and
/// result retirement. The downloader retains the process-wide transport slot.
final class PaliPublicSnapshotBridge: @unchecked Sendable {
  typealias Start = @Sendable (Result<PaliPublicSnapshotInfo, PaliPublicSnapshotDownloadError>) -> Void

  private final class Entry {
    let token = UUID().uuidString
    var operation: PaliPublicSnapshotOperation?
    var result: Result<Void, PaliPublicSnapshotDownloadError>?
    var start: Start?
    var release: (@Sendable () -> Void)?
    var started = false
    var retiring = false
  }

  // A reserved or ready operation can complete synchronously on cancellation.
  private let lock = NSRecursiveLock()
  private var active: Entry?
  private var closed = false

  func prepare(
    _ reserve: (@escaping PaliPublicSnapshotCompletion) throws -> PaliPublicSnapshotOperation
  ) throws -> String {
    try lock.withLock {
      guard !closed else { throw PaliPublicSnapshotDownloadError.cancelled }
      guard active == nil else { throw PaliPublicSnapshotDownloadError.busy }
      let entry = Entry()
      let token = entry.token
      active = entry
      do {
        entry.operation = try reserve { [weak self] result in self?.finish(token, result) }
        return token
      } catch {
        active = nil
        throw error
      }
    }
  }

  func start(_ token: String, completion: @escaping Start) throws {
    try lock.withLock {
      let entry = try current(token)
      guard !entry.started, let operation = entry.operation else {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      entry.started = true
      entry.start = completion
      if entry.result == nil { operation.start() }
      else { settleStart(entry) }
    }
  }

  func pull(_ token: String) throws -> Data? {
    try lock.withLock {
      let entry = try current(token)
      guard entry.started, let operation = entry.operation else {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      return try operation.pull()
    }
  }

  func release(_ token: String, completion: @escaping @Sendable () -> Void) throws {
    try lock.withLock {
      guard let entry = active, entry.token == token else { completion(); return }
      guard entry.release == nil else {
        throw PaliPublicSnapshotDownloadError.invalid
      }
      entry.release = completion
      retire(entry)
    }
  }

  func cancelActive() {
    lock.withLock {
      if let active { retire(active) }
    }
  }

  func close() {
    lock.withLock {
      closed = true
      if let active { retire(active) }
    }
  }

  private func current(_ token: String) throws -> Entry {
    guard !closed, let active, active.token == token, !active.retiring else {
      throw PaliPublicSnapshotDownloadError.cancelled
    }
    return active
  }

  private func finish(_ token: String, _ result: Result<Void, PaliPublicSnapshotDownloadError>) {
    lock.withLock {
      guard let entry = active, entry.token == token, entry.result == nil else { return }
      entry.result = result
      settleStart(entry)
      settleRetirement(entry)
    }
  }

  private func settleStart(_ entry: Entry) {
    guard let result = entry.result, let completion = entry.start else { return }
    entry.start = nil
    if entry.retiring || closed {
      completion(.failure(.cancelled))
      return
    }
    completion(result.flatMap {
      guard let operation = entry.operation else { return .failure(.unavailable) }
      do { return .success(try operation.info()) }
      catch { return .failure(error as? PaliPublicSnapshotDownloadError ?? .unavailable) }
    })
  }

  private func retire(_ entry: Entry) {
    if !entry.retiring {
      entry.retiring = true
      entry.operation?.cancel()
    }
    settleRetirement(entry)
  }

  private func settleRetirement(_ entry: Entry) {
    guard active === entry, entry.retiring, entry.result != nil else { return }
    active = nil
    let completion = entry.release
    entry.release = nil
    completion?()
  }

  deinit { close() }
}
