import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

enum PaliSlhFailure: Error, Sendable { case unavailable }
private let slhTreeBytes = 134_217_712
private let slhLeaves = 4_194_304

func slhHex(_ value: String, bytes: Int) throws -> Data {
  guard value.utf8.count == 2 + bytes * 2 else { throw PaliSlhFailure.unavailable }
  var text = Array(value.utf8)
  defer { text.withUnsafeMutableBufferPointer { $0.baseAddress?.update(repeating: 0, count: $0.count) } }
  guard text[0] == 48, text[1] == 120 else { throw PaliSlhFailure.unavailable }
  func nibble(_ c: UInt8) throws -> UInt8 {
    if c >= 48 && c <= 57 { return c - 48 }
    if c >= 97 && c <= 102 { return c - 87 }
    throw PaliSlhFailure.unavailable
  }
  var result = Data(count: bytes)
  do {
    for index in 0..<bytes { result[index] = try nibble(text[2 + index * 2]) * 16 + nibble(text[3 + index * 2]) }
    return result
  } catch { result.resetBytes(in: 0..<result.count); throw error }
}
private func slhText(_ value: Data) -> String { "0x" + value.map { String(format: "%02x", $0) }.joined() }
private func slhIndex(_ value: Double, _ minimum: Int, _ maximum: Int) throws -> Int {
  guard let result = Int(exactly: value), result >= minimum, result <= maximum else { throw PaliSlhFailure.unavailable }
  return result
}
private func slhRoot(_ keyId: String) throws -> Data {
  let parts = keyId.split(separator: ":", omittingEmptySubsequences: false)
  guard parts.count == 3, parts[0] == "SLH-DSA-SHA2-128-24" else { throw PaliSlhFailure.unavailable }
  let seed = try slhHex(String(parts[1]), bytes: 32), root = try slhHex(String(parts[2]), bytes: 32)
  guard seed.suffix(16).allSatisfy({ $0 == 0 }), root.suffix(16).allSatisfy({ $0 == 0 }) else { throw PaliSlhFailure.unavailable }
  return root.prefix(16)
}
private func slhSame(_ first: stat, _ second: stat) -> Bool {
  first.st_dev == second.st_dev && first.st_ino == second.st_ino && second.st_mode & S_IFMT == S_IFREG && second.st_nlink == 1
}
private func slhProtect(_ url: URL, directory: Bool) throws {
  // PUBLIC tree nodes only. An already-open file must remain readable through
  // C cancellation drainage after device lock; private wallet/key policy is unchanged.
  try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUnlessOpen, .posixPermissions: directory ? 0o700 : 0o600], ofItemAtPath: url.path)
  var target = url, values = URLResourceValues(); values.isExcludedFromBackup = true
  try target.setResourceValues(values); target.removeAllCachedResourceValues()
  let observed = try target.resourceValues(forKeys: [.fileProtectionKey, .isExcludedFromBackupKey, .isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey])
  let permissions = (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue
  guard observed.fileProtection == .completeUnlessOpen, observed.isExcludedFromBackup == true, observed.isSymbolicLink == false,
        directory ? observed.isDirectory == true : observed.isRegularFile == true,
        permissions == (directory ? 0o700 : 0o600) else { throw PaliSlhFailure.unavailable }
}

final class PaliSlhFiles: @unchecked Sendable {
  let url: URL
  private var descriptor: Int32
  init(namespace: String) throws {
    _ = try slhHex(namespace, bytes: 32)
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
    let parent = Darwin.open(support.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard parent >= 0 else { throw PaliSlhFailure.unavailable }
    defer { Darwin.close(parent) }
    let base = "PaliSlhCache"
    guard Darwin.mkdirat(parent, base, 0o700) == 0 || errno == EEXIST else { throw PaliSlhFailure.unavailable }
    let baseFD = Darwin.openat(parent, base, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard baseFD >= 0 else { throw PaliSlhFailure.unavailable }
    defer { Darwin.close(baseFD) }
    let directory = String(namespace.dropFirst(2))
    guard Darwin.mkdirat(baseFD, directory, 0o700) == 0 || errno == EEXIST else { throw PaliSlhFailure.unavailable }
    let fd = Darwin.openat(baseFD, directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw PaliSlhFailure.unavailable }
    url = support.appendingPathComponent(base).appendingPathComponent(directory)
    do { try slhProtect(support.appendingPathComponent(base), directory: true); try slhProtect(url, directory: true) }
    catch { Darwin.close(fd); throw error }
    var opened = stat(), linked = stat()
    guard Darwin.fstat(fd, &opened) == 0, Darwin.fstatat(baseFD, directory, &linked, AT_SYMLINK_NOFOLLOW) == 0,
          opened.st_dev == linked.st_dev, opened.st_ino == linked.st_ino, opened.st_uid == getuid(), opened.st_mode & S_IFMT == S_IFDIR else {
      Darwin.close(fd); throw PaliSlhFailure.unavailable
    }
    descriptor = fd
  }
  func close() throws { if descriptor >= 0 { let fd = descriptor; descriptor = -1; guard Darwin.close(fd) == 0 else { throw PaliSlhFailure.unavailable } } }
  deinit { if descriptor >= 0 { Darwin.close(descriptor) } }
  private func name(_ keyId: String) -> String { SHA256.hash(data: Data(keyId.utf8)).map { String(format: "%02x", $0) }.joined() + ".xmss" }
  func allocate(_ context: PaliSlhContext) throws -> PaliSlhTree {
    let leaf = UUID().uuidString.lowercased() + ".partial"
    let fd = Darwin.openat(descriptor, leaf, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw PaliSlhFailure.unavailable }
    do {
      let tree = try PaliSlhTree(context: context, files: self, descriptor: fd, name: leaf, published: false)
      try tree.initialize(); return tree
    } catch {
      var actual = stat(), linked = stat()
      if Darwin.fstat(fd, &actual) == 0, Darwin.fstatat(descriptor, leaf, &linked, AT_SYMLINK_NOFOLLOW) == 0, slhSame(actual, linked) {
        if Darwin.unlinkat(descriptor, leaf, 0) != 0 { context.markCleanupFailure() }
      } else { context.markCleanupFailure() }
      if Darwin.close(fd) != 0 { context.markCleanupFailure() }; throw error
    }
  }
  func load(_ context: PaliSlhContext, keyId: String) throws -> PaliSlhTree? {
    _ = try slhRoot(keyId)
    let leaf = name(keyId), fd = Darwin.openat(descriptor, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    if fd < 0 { if errno == ENOENT { return nil }; throw PaliSlhFailure.unavailable }
    do {
      let tree = try PaliSlhTree(context: context, files: self, descriptor: fd, name: leaf, published: true)
      try tree.validate(); guard try tree.root() == slhRoot(keyId) else { throw PaliSlhFailure.unavailable }; return tree
    } catch { if Darwin.close(fd) != 0 { context.markCleanupFailure() }; throw error }
  }
  func validate(_ fd: Int32, name: String, expected: stat, size: Int) throws {
    var actual = stat(), linked = stat()
    guard Darwin.fstat(fd, &actual) == 0, Darwin.fstatat(descriptor, name, &linked, AT_SYMLINK_NOFOLLOW) == 0,
          slhSame(expected, actual), slhSame(actual, linked), actual.st_uid == getuid(), actual.st_mode & 0o777 == 0o600,
          actual.st_size == size else { throw PaliSlhFailure.unavailable }
    try slhProtect(url.appendingPathComponent(name), directory: false)
    guard Darwin.fstatat(descriptor, name, &linked, AT_SYMLINK_NOFOLLOW) == 0, slhSame(actual, linked) else { throw PaliSlhFailure.unavailable }
  }
  func publish(_ tree: PaliSlhTree, keyId: String) throws {
    guard !tree.published else { throw PaliSlhFailure.unavailable }
    let target = name(keyId)
    guard try tree.root() == slhRoot(keyId) else { throw PaliSlhFailure.unavailable }
    try tree.validate()
    guard Darwin.fsync(tree.descriptor) == 0 else { throw PaliSlhFailure.unavailable }
    try tree.check()
    guard Darwin.renameat(descriptor, tree.name, descriptor, target) == 0 else { throw PaliSlhFailure.unavailable }
    tree.name = target; tree.published = true
    guard Darwin.fsync(descriptor) == 0 else { throw PaliSlhFailure.unavailable }
    try tree.validate(); try tree.context.check()
  }
  func abort(_ tree: PaliSlhTree) throws {
    guard !tree.published else { return }
    var actual = stat(), linked = stat()
    if Darwin.fstatat(descriptor, tree.name, &linked, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT { return }
    guard Darwin.fstat(tree.descriptor, &actual) == 0, slhSame(tree.identity, actual), slhSame(actual, linked),
          Darwin.unlinkat(descriptor, tree.name, 0) == 0, Darwin.fsync(descriptor) == 0 else { throw PaliSlhFailure.unavailable }
  }
  static func purge(namespace: String, check: () throws -> Void) -> (Bool, Bool) {
    var parent: Int32 = -1, base: Int32 = -1, directory: Int32 = -1
    var listing: UnsafeMutablePointer<DIR>?, clean = true
    let success: Bool = {
      do {
        _ = try slhHex(namespace, bytes: 32); try check()
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return false }
        parent = Darwin.open(support.resolvingSymlinksInPath().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        if parent < 0 { return errno == ENOENT }
        base = Darwin.openat(parent, "PaliSlhCache", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        if base < 0 { return errno == ENOENT }
        var baseInfo = stat()
        guard Darwin.fstat(base, &baseInfo) == 0, baseInfo.st_mode & S_IFMT == S_IFDIR, baseInfo.st_uid == getuid(), baseInfo.st_mode & 0o777 == 0o700 else { return false }
        directory = Darwin.openat(base, String(namespace.dropFirst(2)), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        if directory < 0 { return errno == ENOENT }
        var info = stat()
        guard Darwin.fstat(directory, &info) == 0, info.st_mode & S_IFMT == S_IFDIR, info.st_uid == getuid(), info.st_mode & 0o777 == 0o700 else { return false }
        let copy = Darwin.dup(directory); guard copy >= 0 else { return false }
        listing = Darwin.fdopendir(copy); if listing == nil { if Darwin.close(copy) != 0 { clean = false }; return false }
        while true {
          errno = 0
          guard let entry = Darwin.readdir(listing) else { if errno != 0 { return false }; break }
          try check()
          let leaf = withUnsafePointer(to: &entry.pointee.d_name) { $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) } }
          if leaf == "." || leaf == ".." { continue }
          let published = leaf.range(of: "^[0-9a-f]{64}\\.xmss$", options: .regularExpression) != nil
          let partial = leaf.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.partial$", options: .regularExpression) != nil
          guard published || partial else { return false }
          let fd = Darwin.openat(directory, leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { return false }
          var actual = stat(), linked = stat()
          let valid = Darwin.fstat(fd, &actual) == 0 && Darwin.fstatat(directory, leaf, &linked, AT_SYMLINK_NOFOLLOW) == 0 &&
            slhSame(actual, linked) && actual.st_uid == getuid() && actual.st_mode & 0o777 == 0o600 &&
            (published ? actual.st_size == slhTreeBytes : actual.st_size >= 0 && actual.st_size <= slhTreeBytes)
          var removed = false
          do { try check(); if valid { removed = Darwin.unlinkat(directory, leaf, 0) == 0 } } catch { if Darwin.close(fd) != 0 { clean = false }; throw error }
          if Darwin.close(fd) != 0 { clean = false }
          if !valid || !removed || !clean { return false }
        }
        try check(); return Darwin.fsync(directory) == 0
      } catch { return false }
    }()
    if let listing, Darwin.closedir(listing) != 0 { clean = false }
    for fd in [directory, base, parent] where fd >= 0 { if Darwin.close(fd) != 0 { clean = false } }
    return (success && clean, clean)
  }
}

final class PaliSlhTree: SharedObject, @unchecked Sendable {
  let context: PaliSlhContext, files: PaliSlhFiles, descriptor: Int32, identity: stat
  var name: String, published: Bool
  private let lock = NSLock()
  private let mappingLock = NSLock()
  private var closed = false, released = false
  private var cleanupGood = true
  init(context: PaliSlhContext, files: PaliSlhFiles, descriptor: Int32, name: String, published: Bool) throws {
    var info = stat()
    guard Darwin.fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1,
          info.st_uid == getuid() else { throw PaliSlhFailure.unavailable }
    self.context = context; self.files = files; self.descriptor = descriptor; self.identity = info; self.name = name; self.published = published
    super.init()
  }
  func initialize() throws {
    // Reserve physical space before mmap: a sparse ftruncate can SIGBUS on ENOSPC inside C.
    var allocation = fstore_t()
    allocation.fst_flags = UInt32(F_ALLOCATEALL); allocation.fst_posmode = Int32(F_PEOFPOSMODE)
    allocation.fst_offset = 0; allocation.fst_length = off_t(slhTreeBytes)
    guard Darwin.fcntl(descriptor, F_PREALLOCATE, &allocation) == 0,
          allocation.fst_bytesalloc >= slhTreeBytes,
          Darwin.ftruncate(descriptor, off_t(slhTreeBytes)) == 0 else { throw PaliSlhFailure.unavailable }
    try validate()
  }
  func validate() throws { try files.validate(descriptor, name: name, expected: identity, size: slhTreeBytes) }
  func check() throws { lock.lock(); let live = !closed && cleanupGood; lock.unlock(); guard live else { throw PaliSlhFailure.unavailable }; try context.check() }
  func root() throws -> Data {
    try check(); try validate(); var result = Data(count: 16)
    let bytes = result.withUnsafeMutableBytes { Darwin.pread(descriptor, $0.baseAddress, 16, off_t(slhTreeBytes - 16)) }
    guard bytes == 16 else { throw PaliSlhFailure.unavailable }; try check(); return result
  }
  func access<T>(write: Bool, _ body: (UnsafeMutablePointer<UInt8>) throws -> T) throws -> T {
    mappingLock.lock(); defer { mappingLock.unlock() }
    lock.lock(); let usable = !closed && (!write || !published); lock.unlock()
    guard usable else { throw PaliSlhFailure.unavailable }
    try context.check(); try validate()
    let mapped = Darwin.mmap(nil, slhTreeBytes, PROT_READ | (write ? PROT_WRITE : 0), write ? MAP_SHARED : MAP_PRIVATE, descriptor, 0)
    guard mapped != MAP_FAILED, let mapped else { throw PaliSlhFailure.unavailable }
    let result = Result { try body(mapped.assumingMemoryBound(to: UInt8.self)) }
    guard Darwin.munmap(mapped, slhTreeBytes) == 0 else {
      lock.lock(); cleanupGood = false; lock.unlock()
      context.markCleanupFailure(); context.close(); throw PaliSlhFailure.unavailable
    }
    try check(); try validate(); return try result.get()
  }
  func release(_ complete: @escaping @Sendable (Bool) -> Void) {
    lock.lock(); closed = true; lock.unlock()
    PaliSlhLeafWorker.shared.cleanup { [self] in
      mappingLock.lock(); defer { mappingLock.unlock() }
      lock.lock(); defer { lock.unlock() }
      if !released {
        do { try files.abort(self) } catch { cleanupGood = false }
        if Darwin.close(descriptor) != 0 { cleanupGood = false }; released = true
      }
      context.releaseTreeOwnership(self, clean: cleanupGood)
      complete(cleanupGood)
    }
  }
  override func sharedObjectDidRelease() { release { _ in } }
}

/** No key/context/FD is captured until this confirmed-removal operation runs. */
final class PaliSlhCachePurge: SharedObject, @unchecked Sendable {
  private let namespace: String, owner: PaliSlhOperationOwner
  private let lock = NSLock()
  private var started = false, cancelled = false
  init(namespace: String, owner: PaliSlhOperationOwner) throws {
    _ = try slhHex(namespace, bytes: 32)
    self.namespace = namespace; self.owner = owner; super.init()
    owner.onRetire { [weak self] in self?.cancel() }
  }
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  private func check() throws {
    lock.lock(); let live = !cancelled; lock.unlock()
    guard live && owner.isOpen else { throw PaliSlhFailure.unavailable }
  }
  func run(_ promise: Promise) {
    lock.lock(); let admitted = !started && !cancelled; if admitted { started = true }; lock.unlock()
    do { guard admitted else { throw PaliSlhFailure.unavailable }; try check(); guard owner.beginPurge(namespace) else { throw PaliSlhFailure.unavailable } }
    catch { reject(promise); return }
    let accepted = PaliSlhLeafWorker.shared.enqueue({ [self] in PaliSlhFiles.purge(namespace: namespace, check: check) }, complete: { [self] result in
      owner.endPurge(namespace, clean: result.1)
      do { try check(); guard result.0 else { throw PaliSlhFailure.unavailable }; promise.resolve() }
      catch { reject(promise) }
    })
    if !accepted { owner.endPurge(namespace, clean: true); reject(promise) }
  }
  private func reject(_ promise: Promise) { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") }
  override func sharedObjectDidRelease() { cancel() }
}

private final class WeakSlhOperation { weak var value: PaliSlhOperation?; init(_ value: PaliSlhOperation) { self.value = value } }
enum PaliSlhValue: @unchecked Sendable { case none, text(String), number(Int), boolean(Bool), tree(PaliSlhTree?) }

final class PaliSlhContext: SharedObject, @unchecked Sendable {
  let crypto = PaliCryptoContext()
  private let owner: PaliSlhOperationOwner
  private let namespace: String
  private let files: PaliSlhFiles
  private let lock = NSLock()
  private var closed = false, active = 0
  private var disposing = false, disposed = false
  private var disposalGood = true
  private var operations: [WeakSlhOperation] = []
  private var trees: [PaliSlhTree] = []
  private var waiters: [Promise] = []
  init(namespace: String, owner: PaliSlhOperationOwner) throws {
    _ = try slhHex(namespace, bytes: 32)
    guard owner.openNamespace(namespace) else { throw PaliSlhFailure.unavailable }
    self.owner = owner; self.namespace = namespace
    do { files = try PaliSlhFiles(namespace: namespace) }
    catch { owner.closeNamespace(namespace, clean: true); throw error }
    super.init(); owner.onRetire { [weak self] in self?.close() }
  }
  func check() throws {
    lock.lock(); let live = !closed; lock.unlock()
    guard live, owner.isOpen else { throw PaliSlhFailure.unavailable }; try crypto.ensureOpen()
  }
  func isRetired() -> Bool { lock.lock(); defer { lock.unlock() }; return closed }
  func markCleanupFailure() { lock.lock(); disposalGood = false; lock.unlock() }
  func releaseTreeOwnership(_ tree: PaliSlhTree, clean: Bool) {
    lock.lock(); trees.removeAll { $0 === tree }; disposalGood = disposalGood && clean; lock.unlock()
    if !clean { close() }
  }
  func checkMaterial(_ value: PaliCryptoKey, seed: Bool) throws {
    try check()
    guard value.isUsable(owner: crypto, kind: seed ? "SLH-DSA-SEED" : "SLH-DSA-SK", usage: seed ? "derivePublic" : "sign") else { throw PaliSlhFailure.unavailable }
  }
  func importMaterial(_ value: String, seed: Bool) throws -> PaliCryptoKey {
    try check(); var bytes = try slhHex(value, bytes: seed ? 48 : 64)
    defer { bytes.resetBytes(in: 0..<bytes.count) }
    return try crypto.importSlhMaterial(bytes, seed: seed)
  }
  func track(_ operation: PaliSlhOperation) throws {
    try check(); lock.lock(); defer { lock.unlock() }; guard !closed else { throw PaliSlhFailure.unavailable }
    operations.removeAll { $0.value == nil }; operations.append(WeakSlhOperation(operation))
  }
  func begin() throws { try check(); lock.lock(); defer { lock.unlock() }; guard !closed else { throw PaliSlhFailure.unavailable }; active += 1 }
  func end() { lock.lock(); active -= 1; let finish = closed && active == 0; lock.unlock(); if finish { finishDisposal() } }
  func close() {
    lock.lock(); closed = true; let live = operations.compactMap { $0.value }; let finish = active == 0; lock.unlock()
    crypto.close(); live.forEach { $0.cancel() }; if finish { finishDisposal() }
  }
  func dispose(_ promise: Promise) {
    lock.lock(); let complete = disposed; if !complete { waiters.append(promise) }; lock.unlock()
    if complete { finishPromise(promise) } else { close() }
  }
  private func finishPromise(_ promise: Promise) { if disposalGood { promise.resolve() } else { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") } }
  private func finishDisposal() {
    lock.lock(); guard !disposing && !disposed && active == 0 else { lock.unlock(); return }
    disposing = true; let live = trees; trees.removeAll(); lock.unlock()
    let group = DispatchGroup()
    for tree in live { group.enter(); tree.release { [self] good in lock.lock(); disposalGood = disposalGood && good; lock.unlock(); group.leave() } }
    group.notify(queue: .global(qos: .userInitiated)) { [self] in
      lock.lock(); do { try files.close() } catch { disposalGood = false }; disposed = true; let callbacks = waiters; waiters.removeAll(); let clean = disposalGood; lock.unlock()
      owner.closeNamespace(namespace, clean: clean)
      callbacks.forEach { finishPromise($0) }
    }
  }
  private func tree(_ value: PaliSlhTree) throws { try check(); guard value.context === self else { throw PaliSlhFailure.unavailable } }
  private func key(_ value: PaliCryptoKey, seed: Bool) throws -> Data {
    try check(); return try value.copyMaterial(owner: crypto, kind: seed ? "SLH-DSA-SEED" : "SLH-DSA-SK", usage: seed ? "derivePublic" : "sign")
  }
  private func operation(_ bytes: [Data] = [], material: PaliCryptoKey?, seed: Bool = false, _ body: @escaping @Sendable ([Data]) throws -> PaliSlhValue) throws -> PaliSlhOperation {
    let operation = PaliSlhOperation(context: self, material: material, seed: seed, bytes: bytes, body: body); try track(operation); return operation
  }
  func allocateTree() throws -> PaliSlhOperation { try operation(material: nil) { [self] _ in
    let value = try files.allocate(self); lock.lock(); trees.append(value); lock.unlock(); return .tree(value)
  } }
  func loadTree(_ id: String) throws -> PaliSlhOperation { _ = try slhRoot(id); return try operation(material: nil) { [self] _ in
    let value = try files.load(self, keyId: id); if let value { lock.lock(); trees.append(value); lock.unlock() }; return .tree(value)
  } }
  func publishTree(_ value: PaliSlhTree, id: String) throws -> PaliSlhOperation {
    try tree(value); _ = try slhRoot(id); return try operation(material: nil) { [self] _ in try tree(value); try files.publish(value, keyId: id); return .none }
  }
  func readRoot(_ value: PaliSlhTree) throws -> PaliSlhOperation { try tree(value); return try operation(material: nil) { [self] _ in try tree(value); return .text(slhText(try value.root())) } }
  func writeLeaves(_ value: PaliSlhTree, start: Double, hex: String) throws -> PaliSlhOperation {
    try tree(value); let count = (hex.utf8.count - 2) / 32
    guard count > 0 && count <= 8192 else { throw PaliSlhFailure.unavailable }
    let first = try slhIndex(start, 0, slhLeaves - count), bytes = try slhHex(hex, bytes: count * 16)
    return try operation([bytes], material: nil) { input in try value.access(write: true) { pointer in input[0].copyBytes(to: pointer.advanced(by: first * 16), count: count * 16) }; return .none }
  }
  func treeChunk(_ material: PaliCryptoKey, value: PaliSlhTree, level: Double, start: Double, count: Double) throws -> PaliSlhOperation {
    try tree(value); let height = try slhIndex(level, 0, 22), size = try slhIndex(count, 1, 8192), first = try slhIndex(start, 0, (slhLeaves >> height) - size)
    return try operation(material: material, seed: true) { [self] _ in
      var seed = try key(material, seed: true); defer { seed.resetBytes(in: 0..<seed.count) }
      try value.access(write: true) { pointer in
        let status = seed.withUnsafeBytes { pali_slh_tree_level($0.baseAddress!.assumingMemoryBound(to: UInt8.self), $0.count, pointer, slhTreeBytes, UInt32(height), UInt32(first), UInt32(size)) }
        guard status == PALI_SLH_OK else { throw PaliSlhFailure.unavailable }
      }; return .number(size)
    }
  }
  func leafChunk(_ material: PaliCryptoKey, start: Double, count: Double) throws -> PaliSlhOperation {
    let size = try slhIndex(count, 1, 8192), first = try slhIndex(start, 0, slhLeaves - size)
    return try operation(material: material, seed: true) { [self] _ in
      var seed = try key(material, seed: true), output = Data(count: size * 16)
      defer { seed.resetBytes(in: 0..<seed.count); output.resetBytes(in: 0..<output.count) }
      let status = seed.withUnsafeBytes { source in output.withUnsafeMutableBytes { target in pali_slh_leaf_chunk(source.baseAddress!.assumingMemoryBound(to: UInt8.self), source.count, UInt32(first), UInt32(size), target.baseAddress!.assumingMemoryBound(to: UInt8.self), target.count) } }
      guard status == PALI_SLH_OK else { throw PaliSlhFailure.unavailable }; return .text(slhText(output))
    }
  }
  private func message(_ value: String) throws -> Data { var bytes = try slhHex(value, bytes: 34); defer { bytes.resetBytes(in: 0..<bytes.count) }; guard bytes[0] == 0 && bytes[1] == 0 else { throw PaliSlhFailure.unavailable }; return Data(bytes.dropFirst(2)) }
  func prepareVerify(_ publicKey: String, action: String, signature: String) throws -> PaliSlhOperation {
    try operation([slhHex(publicKey, bytes: 32), slhHex(action, bytes: 32), slhHex(signature, bytes: 3856)], material: nil) { input in
      let status = input[0].withUnsafeBytes { key in input[1].withUnsafeBytes { action in input[2].withUnsafeBytes { signature in
        pali_slh_verify(key.baseAddress!.assumingMemoryBound(to: UInt8.self), key.count, action.baseAddress!.assumingMemoryBound(to: UInt8.self), action.count, signature.baseAddress!.assumingMemoryBound(to: UInt8.self), signature.count)
      } } }
      guard status == PALI_SLH_OK || status == PALI_SLH_INVALID_SIGNATURE else { throw PaliSlhFailure.unavailable }
      return .boolean(status == PALI_SLH_OK)
    }
  }
  func prelude(_ material: PaliCryptoKey, message: String, optrand: String) throws -> PaliSlhOperation {
    try signing(material, bytes: [self.message(message), slhHex(optrand, bytes: 16)], length: 46) { key, input, output in
      key.withUnsafeBytes { source in input[0].withUnsafeBytes { action in input[1].withUnsafeBytes { random in output.withUnsafeMutableBytes { target in pali_slh_prelude(source.baseAddress!.assumingMemoryBound(to: UInt8.self), source.count, action.baseAddress!.assumingMemoryBound(to: UInt8.self), action.count, random.baseAddress!.assumingMemoryBound(to: UInt8.self), random.count, target.baseAddress!.assumingMemoryBound(to: UInt8.self), target.count) } } } }
    }
  }
  func fors(_ material: PaliCryptoKey, prelude: String, index: Double) throws -> PaliSlhOperation {
    let tree = try slhIndex(index, 0, 5)
    return try signing(material, bytes: [slhHex(prelude, bytes: 46)], length: 416) { key, input, output in
      key.withUnsafeBytes { source in input[0].withUnsafeBytes { prefix in output.withUnsafeMutableBytes { target in pali_slh_fors_tree(source.baseAddress!.assumingMemoryBound(to: UInt8.self), source.count, prefix.baseAddress!.assumingMemoryBound(to: UInt8.self), prefix.count, UInt32(tree), target.baseAddress!.assumingMemoryBound(to: UInt8.self), target.count) } } }
    }
  }
  func cached(_ material: PaliCryptoKey, message: String, optrand: String, value: PaliSlhTree) throws -> PaliSlhOperation {
    try tree(value)
    return try signing(material, bytes: [self.message(message), slhHex(optrand, bytes: 16)], length: 3856) { key, input, output in
      try value.access(write: false) { tree in key.withUnsafeBytes { source in input[0].withUnsafeBytes { action in input[1].withUnsafeBytes { random in output.withUnsafeMutableBytes { target in pali_slh_sign_cached(source.baseAddress!.assumingMemoryBound(to: UInt8.self), source.count, action.baseAddress!.assumingMemoryBound(to: UInt8.self), action.count, random.baseAddress!.assumingMemoryBound(to: UInt8.self), random.count, tree, slhTreeBytes, target.baseAddress!.assumingMemoryBound(to: UInt8.self), target.count) } } } } }
    }
  }
  func finish(_ material: PaliCryptoKey, message: String, prelude: String, fors: String, roots: String, value: PaliSlhTree) throws -> PaliSlhOperation {
    try tree(value)
    return try signing(material, bytes: [self.message(message), slhHex(prelude, bytes: 46), slhHex(fors, bytes: 2400), slhHex(roots, bytes: 96)], length: 3856) { key, input, output in
      try value.access(write: false) { tree in key.withUnsafeBytes { source in input[0].withUnsafeBytes { action in input[1].withUnsafeBytes { prefix in input[2].withUnsafeBytes { shards in input[3].withUnsafeBytes { roots in output.withUnsafeMutableBytes { target in pali_slh_finish(source.baseAddress!.assumingMemoryBound(to: UInt8.self), source.count, action.baseAddress!.assumingMemoryBound(to: UInt8.self), action.count, prefix.baseAddress!.assumingMemoryBound(to: UInt8.self), prefix.count, shards.baseAddress!.assumingMemoryBound(to: UInt8.self), shards.count, roots.baseAddress!.assumingMemoryBound(to: UInt8.self), roots.count, tree, slhTreeBytes, target.baseAddress!.assumingMemoryBound(to: UInt8.self), target.count) } } } } } } }
    }
  }
  private func signing(_ material: PaliCryptoKey, bytes: [Data], length: Int,
                       _ call: @escaping @Sendable (Data, [Data], inout Data) throws -> pali_slh_status) throws -> PaliSlhOperation {
    try operation(bytes, material: material) { [self] input in
      var key = try self.key(material, seed: false), output = Data(count: length)
      defer { key.resetBytes(in: 0..<key.count); output.resetBytes(in: 0..<output.count) }
      guard try call(key, input, &output) == PALI_SLH_OK else { throw PaliSlhFailure.unavailable }; return .text(slhText(output))
    }
  }
  override func sharedObjectDidRelease() { close() }
}

final class PaliSlhOperation: SharedObject, @unchecked Sendable {
  private let context: PaliSlhContext
  private let material: PaliCryptoKey?, seed: Bool
  private let lock = NSLock()
  private var started = false, cancelled = false
  private var bytes: [Data]
  private let body: @Sendable ([Data]) throws -> PaliSlhValue
  init(context: PaliSlhContext, material: PaliCryptoKey?, seed: Bool, bytes: [Data], body: @escaping @Sendable ([Data]) throws -> PaliSlhValue) { self.context = context; self.material = material; self.seed = seed; self.bytes = bytes; self.body = body; super.init() }
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  private func check() throws { lock.lock(); let live = !cancelled; lock.unlock(); guard live else { throw PaliSlhFailure.unavailable }; try context.check(); if let material { try context.checkMaterial(material, seed: seed) } }
  func run(_ promise: Promise) {
    lock.lock(); let admitted = !started && !cancelled; if admitted { started = true }; lock.unlock()
    do { guard admitted else { throw PaliSlhFailure.unavailable }; try check(); try context.begin() }
    catch { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable"); return }
    let accepted = PaliSlhLeafWorker.shared.enqueue({ [self] () -> (Result<PaliSlhValue, PaliSlhFailure>, PaliSlhTree?) in
      defer { clear() }
      var produced: PaliSlhValue?
      do { try check(); let result = try body(bytes); produced = result; try check(); return (.success(result), nil) }
      catch {
        if case .tree(let tree) = produced { return (.failure(.unavailable), tree) }
        return (.failure(.unavailable), nil)
      }
    }, complete: { [self] outcome in
      context.end()
      do {
        try check(); let value = try outcome.0.get()
        switch value { case .none: promise.resolve(); case .text(let text): promise.resolve(text); case .number(let count): promise.resolve(count); case .boolean(let valid): promise.resolve(valid); case .tree(let tree): promise.resolve(tree) }
      } catch {
        let tree: PaliSlhTree?
        if case .success(.tree(let value)) = outcome.0 { tree = value } else { tree = outcome.1 }
        // The worker/C call has returned. Join resource cleanup before rejecting,
        // including when ONLY this operation was canceled and its context stays live.
        if let tree { tree.release { _ in promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") } }
        else { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") }
      }
    })
    if !accepted { context.end(); clear(); promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") }
  }
  private func clear() { for index in bytes.indices { let count = bytes[index].count; bytes[index].resetBytes(in: 0..<count) } }
  override func sharedObjectDidRelease() { cancel() }
}
