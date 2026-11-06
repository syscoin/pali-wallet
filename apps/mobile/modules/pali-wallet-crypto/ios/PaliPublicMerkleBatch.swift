import Foundation

final class PaliPublicMerkleBatchOwner: @unchecked Sendable {
  private let mutex = NSLock()
  private var closed = false

  func retire() {
    mutex.lock(); defer { mutex.unlock() }
    closed = true
  }

  var isOpen: Bool {
    mutex.lock(); defer { mutex.unlock() }
    return !closed
  }
}

enum PaliPublicMerkleBatchFailure: Error {
  case unavailable
}

final class PaliPublicMerkleBatch: @unchecked Sendable {
  static let shared = PaliPublicMerkleBatch()
  private let mutex = NSLock()
  private let queue = DispatchQueue(label: "org.paliwallet.public-merkle", qos: .userInitiated)
  private var busy = false

  func execute(
    _ program: Data,
    owner: PaliPublicMerkleBatchOwner,
    complete: @escaping @Sendable (Result<Data, PaliPublicMerkleBatchFailure>) -> Void
  ) {
    guard program.count >= Int(MIMC_BATCH_HEADER_BYTES),
          program.count <= Int(MIMC_BATCH_MAX_INPUT), owner.isOpen else {
      complete(.failure(.unavailable))
      return
    }
    let count = program.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
      (Int(bytes[1]) << 8) | Int(bytes[2])
    }
    guard count > 0, count <= Int(MIMC_BATCH_MAX_OPERATIONS),
          program.count == Int(MIMC_BATCH_HEADER_BYTES) + count * Int(MIMC_BATCH_OPERATION_BYTES) else {
      complete(.failure(.unavailable))
      return
    }
    mutex.lock()
    let admitted = !busy
    if admitted { busy = true }
    mutex.unlock()
    guard admitted else {
      complete(.failure(.unavailable))
      return
    }

    // Copy before queuing. No native work retains a JS-backed byte view.
    let owned = program.withUnsafeBytes { Data(bytes: $0.baseAddress!, count: $0.count) }
    queue.async {
      let result: Result<Data, PaliPublicMerkleBatchFailure>
      if owner.isOpen {
        var output = Data(count: count * Int(MIMC_BATCH_WORD_BYTES))
        let accepted = owned.withUnsafeBytes { input in
          output.withUnsafeMutableBytes { destination in
            mimc_batch_execute(
              input.baseAddress!.assumingMemoryBound(to: UInt8.self), input.count,
              destination.baseAddress!.assumingMemoryBound(to: UInt8.self), destination.count
            )
          }
        }
        result = accepted && owner.isOpen ? .success(output) : .failure(.unavailable)
      } else {
        result = .failure(.unavailable)
      }
      // Release only after the C invocation has returned. Retirement never
      // resolves early or makes an unfinished invocation's slot reusable.
      self.mutex.lock()
      self.busy = false
      self.mutex.unlock()
      complete(owner.isOpen ? result : .failure(.unavailable))
    }
  }
}
