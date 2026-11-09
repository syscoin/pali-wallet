import ExpoModulesCore
import Foundation

final class PaliSlhOperationOwner: @unchecked Sendable {
  private let mutex = NSLock()
  private var closed = false
  private var foreground = true
  private var retirements: [() -> Void] = []
  private var namespaces: [String: Int] = [:]
  private var purging: Set<String> = []
  private var poisoned: Set<String> = []
  func openNamespace(_ namespace: String) -> Bool {
    mutex.lock(); defer { mutex.unlock() }
    guard !closed && foreground && !purging.contains(namespace) && !poisoned.contains(namespace) else { return false }
    namespaces[namespace, default: 0] += 1; return true
  }
  func closeNamespace(_ namespace: String, clean: Bool) {
    mutex.lock(); defer { mutex.unlock() }
    if clean { namespaces[namespace, default: 0] -= 1 } else { poisoned.insert(namespace) }
  }
  func beginPurge(_ namespace: String) -> Bool {
    mutex.lock(); defer { mutex.unlock() }
    guard !closed && foreground && namespaces[namespace, default: 0] == 0 && !purging.contains(namespace) && !poisoned.contains(namespace) else { return false }
    purging.insert(namespace); return true
  }
  func endPurge(_ namespace: String, clean: Bool) {
    mutex.lock(); defer { mutex.unlock() }
    if clean { purging.remove(namespace) } else { poisoned.insert(namespace) }
  }
  func retire() {
    mutex.lock(); closed = true; let callbacks = retirements; retirements.removeAll(); mutex.unlock()
    callbacks.forEach { $0() }
  }
  func onRetire(_ callback: @escaping () -> Void) {
    mutex.lock(); let retired = closed || !foreground; if !retired { retirements.append(callback) }; mutex.unlock()
    if retired { callback() }
  }
  func background() { mutex.lock(); foreground = false; let callbacks = retirements; mutex.unlock(); callbacks.forEach { $0() } }
  func resume() { mutex.lock(); foreground = true; mutex.unlock() }
  var isOpen: Bool { mutex.lock(); defer { mutex.unlock() }; return !closed && foreground }
}

enum PaliSlhLeafFailure: Error, Sendable { case unavailable }

private final class PaliSlhOwnedSeed: @unchecked Sendable {
  var bytes: Data
  init(_ ownedBytes: Data) { bytes = ownedBytes }
  func clear() { bytes.resetBytes(in: 0..<bytes.count) }
  deinit { clear() }
}

/** A setup-only operation. Its result contains public WOTS leaves. */
final class PaliSlhLeafOperation: SharedObject, @unchecked Sendable {
  private static let keyKind = "SLH-DSA-SEED"
  private static let keyUsage = "derivePublic"
  private let mutex = NSLock()
  private let context: PaliCryptoContext
  private let key: PaliCryptoKey
  private let owner: PaliSlhOperationOwner
  private let start: UInt32
  private let count: UInt32
  private var started = false
  private var retired = false

  init(context: PaliCryptoContext, key: PaliCryptoKey, owner: PaliSlhOperationOwner,
       start: Double, count: Double) throws {
    guard count > 0, count <= Double(PALI_SLH_MAX_LEAF_CHUNK),
          start >= 0, start <= Double(PALI_SLH_XMSS_LEAVES) - count,
          let firstLeaf = UInt32(exactly: start), let leafCount = UInt32(exactly: count), owner.isOpen,
          key.isUsable(owner: context, kind: Self.keyKind, usage: Self.keyUsage) else {
      throw PaliSlhLeafFailure.unavailable
    }
    try context.ensureOpen()
    self.context = context; self.key = key; self.owner = owner
    self.start = firstLeaf; self.count = leafCount
    super.init()
    owner.onRetire { [weak self] in self?.cancel() }
  }

  func cancel() { mutex.lock(); retired = true; mutex.unlock() }
  override func sharedObjectDidRelease() { cancel() }

  private var isCurrent: Bool {
    mutex.lock(); let live = !retired; mutex.unlock()
    return live && owner.isOpen && (try? context.ensureOpen()) != nil &&
      key.isUsable(owner: context, kind: Self.keyKind, usage: Self.keyUsage)
  }

  func execute(_ complete: @escaping @Sendable (Result<Data, PaliSlhLeafFailure>) -> Void) {
    mutex.lock()
    let admitted = !started && !retired
    if admitted { started = true }
    mutex.unlock()
    guard admitted, isCurrent else { complete(.failure(.unavailable)); return }
    PaliSlhLeafWorker.shared.execute(self, complete)
  }

  fileprivate func copySeed() throws -> PaliSlhOwnedSeed {
    guard isCurrent else { throw PaliSlhLeafFailure.unavailable }
    // copyMaterial returns a fresh allocation, independent of key and JS bytes.
    return PaliSlhOwnedSeed(try key.copyMaterial(owner: context, kind: Self.keyKind, usage: Self.keyUsage))
  }

  fileprivate func run(seed: inout Data) -> Result<Data, PaliSlhLeafFailure> {
    guard isCurrent else { return .failure(.unavailable) }
    var output = Data(count: Int(count) * 16)
    let status = seed.withUnsafeBytes { input in
      output.withUnsafeMutableBytes { destination in
        pali_slh_leaf_chunk(input.baseAddress!.assumingMemoryBound(to: UInt8.self), input.count,
          start, count, destination.baseAddress!.assumingMemoryBound(to: UInt8.self), destination.count)
      }
    }
    guard status == PALI_SLH_OK, isCurrent else {
      output.resetBytes(in: 0..<output.count)
      return .failure(.unavailable)
    }
    return .success(output)
  }

  fileprivate func deliver(_ result: Result<Data, PaliSlhLeafFailure>,
                           _ complete: @Sendable (Result<Data, PaliSlhLeafFailure>) -> Void) {
    complete(isCurrent ? result : .failure(.unavailable))
  }
}

final class PaliSlhLeafWorker: @unchecked Sendable {
  static let shared = PaliSlhLeafWorker()
  private let mutex = NSLock()
  private let queue = DispatchQueue(label: "org.paliwallet.slh-setup", qos: .userInitiated)
  private var busy = false
  func cleanup(_ work: @escaping @Sendable () -> Void) { queue.async(execute: work) }

  func enqueue<T: Sendable>(_ work: @escaping @Sendable () -> T,
                           complete: @escaping @Sendable (T) -> Void) -> Bool {
    mutex.lock(); let admitted = !busy; if admitted { busy = true }; mutex.unlock()
    guard admitted else { return false }
    queue.async {
      let result = work()
      self.mutex.lock(); self.busy = false; self.mutex.unlock()
      complete(result)
    }
    return true
  }

  func execute(_ operation: PaliSlhLeafOperation,
               _ complete: @escaping @Sendable (Result<Data, PaliSlhLeafFailure>) -> Void) {
    let copied: PaliSlhOwnedSeed
    do { copied = try operation.copySeed() }
    catch {
      complete(.failure(.unavailable))
      return
    }
    let admitted = enqueue({
      let result = operation.run(seed: &copied.bytes)
      // Cancellation retires output only. The live C input stays owned until return.
      copied.clear()
      return result
    }, complete: { result in
      operation.deliver(result, complete)
    })
    if !admitted { copied.clear(); complete(.failure(.unavailable)) }
  }
}
