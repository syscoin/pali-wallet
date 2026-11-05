import Darwin
import Foundation

enum PaliNoteBackupFileError: String, Error, Sendable {
  case busy = "NOTE_BACKUP_FILE_BUSY"
  case unavailable = "NOTE_BACKUP_FILE_UNAVAILABLE"
  case invalid = "NOTE_BACKUP_FILE_INVALID"
  case tooLarge = "NOTE_BACKUP_FILE_TOO_LARGE"
  case writeUnconfirmed = "NOTE_BACKUP_FILE_WRITE_UNCONFIRMED"
}

final class PaliNoteBackupPickerOwner: @unchecked Sendable {
  private let lock = NSLock()
  private var active = true

  var isActive: Bool { lock.withLock { active } }
  func retire() { lock.withLock { active = false } }
}

final class PaliNoteBackupDestination: @unchecked Sendable {
  static let lifetimeSeconds = 300
  private static let lifetimeNanoseconds = UInt64(lifetimeSeconds) * 1_000_000_000
  private enum State { case selected, writing, revoked }

  let owner: PaliNoteBackupPickerOwner
  let directory: URL
  let token = UUID().uuidString
  private let issuedAt: UInt64
  private let lock = NSLock()
  private var state = State.selected

  init(owner: PaliNoteBackupPickerOwner, directory: URL, now: UInt64 = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) {
    self.owner = owner
    self.directory = directory
    self.issuedAt = now
  }

  func matches(_ owner: PaliNoteBackupPickerOwner, _ token: String) -> Bool {
    self.owner === owner && self.token == token
  }

  func begin(now: UInt64 = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) throws {
    try lock.withLock {
      guard state == .selected, live(at: now) else { throw PaliNoteBackupFileError.unavailable }
      state = .writing
    }
  }

  func check(now: UInt64 = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)) throws {
    try lock.withLock {
      guard state == .writing, live(at: now) else { throw PaliNoteBackupFileError.unavailable }
    }
  }

  func revoke() { lock.withLock { state = .revoked } }

  private func live(at now: UInt64) -> Bool {
    owner.isActive && now >= issuedAt && now - issuedAt < Self.lifetimeNanoseconds
  }
}

enum PaliNoteBackupFile {
  // Match the shared noteBackup.ts transport cap: header, ciphertext and GCM tag.
  private static let headerBytes = 64
  private static let minimumBytes = headerBytes + 16
  private static let maximumBytes = 8 * 1024 * 1024 + minimumBytes
  private static let magic = Array("PALINOTE".utf8)

  static func read(_ url: URL) throws -> Data {
    guard url.isFileURL else { throw PaliNoteBackupFileError.invalid }
    let descriptor = url.withUnsafeFileSystemRepresentation { path -> Int32 in
      guard let path else { return -1 }
      return Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    }
    guard descriptor >= 0 else { throw PaliNoteBackupFileError.unavailable }
    defer { _ = Darwin.close(descriptor) }
    return try read(descriptor, limit: maximumBytes)
  }

  private static func read(_ descriptor: Int32, limit: Int) throws -> Data {
    var info = stat()
    guard Darwin.fstat(descriptor, &info) == 0 else { throw PaliNoteBackupFileError.unavailable }
    guard info.st_mode & S_IFMT == S_IFREG, info.st_size >= 0 else {
      throw PaliNoteBackupFileError.invalid
    }
    guard info.st_size <= limit else { throw PaliNoteBackupFileError.tooLarge }

    var data = Data()
    data.reserveCapacity(Int(info.st_size))
    var chunk = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
      // Probe for EOF even if the provider reports a smaller size or the file grows.
      let requested = min(chunk.count, limit - data.count + 1)
      let count = chunk.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, requested) }
      if count < 0 {
        if errno == EINTR { continue }
        throw PaliNoteBackupFileError.unavailable
      }
      if count == 0 { break }
      guard count <= limit - data.count else { throw PaliNoteBackupFileError.tooLarge }
      data.append(contentsOf: chunk.prefix(count))
      // A transport sniff only. The shared codec owns framing and authentication.
      if data.count >= magic.count && !data.starts(with: magic) {
        throw PaliNoteBackupFileError.invalid
      }
    }
    guard data.count >= minimumBytes else { throw PaliNoteBackupFileError.invalid }
    return data
  }

  static func validateExport(_ data: Data) throws {
    guard data.count <= maximumBytes else { throw PaliNoteBackupFileError.tooLarge }
    guard data.count >= minimumBytes, data.starts(with: magic) else { throw PaliNoteBackupFileError.invalid }
    // Transport framing only. Authentication remains in the shared codec.
    let framed = data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
      let ciphertextLength = bytes[56..<60].reduce(0) { ($0 << 8) | Int($1) }
      return bytes[8..<12].elementsEqual([1, 1, 1, 0]) &&
        bytes[60..<64].allSatisfy { $0 == 0 } &&
        ciphertextLength == data.count - headerBytes
    }
    guard framed else { throw PaliNoteBackupFileError.invalid }
  }

  static func write(_ data: Data, in directory: URL, nameId: UUID = UUID(), check: () throws -> Void) throws -> Data {
    try validateExport(data)
    try check()
    guard directory.isFileURL else { throw PaliNoteBackupFileError.invalid }
    let parent = directory.withUnsafeFileSystemRepresentation { path -> Int32 in
      guard let path else { return -1 }
      let length = strlen(path)
      guard length > 0, length == 1 || path[length - 1] != 47 else { return -1 }
      return Darwin.open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    }
    guard parent >= 0 else { throw PaliNoteBackupFileError.unavailable }
    defer { _ = Darwin.close(parent) }

    let leaf = "pali-private-notes-\(nameId.uuidString.lowercased()).palibak"
    try check()
    var writer = Darwin.openat(parent, leaf, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard writer >= 0 else { throw PaliNoteBackupFileError.unavailable }
    defer { if writer >= 0 { _ = Darwin.close(writer) } }

    do {
      var created = stat()
      guard Darwin.fstat(writer, &created) == 0, isSingleRegularFile(created), created.st_size == 0 else {
        throw PaliNoteBackupFileError.writeUnconfirmed
      }
      try data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
        var offset = 0
        while offset < bytes.count {
          try check()
          let count = Darwin.write(writer, bytes.baseAddress!.advanced(by: offset), min(bytes.count - offset, 64 * 1024))
          if count < 0 && errno == EINTR { continue }
          guard count > 0 else { throw PaliNoteBackupFileError.writeUnconfirmed }
          offset += count
        }
      }
      try check()
      guard Darwin.fsync(writer) == 0 else { throw PaliNoteBackupFileError.writeUnconfirmed }
      try check()

      var reader = Darwin.openat(parent, leaf, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
      guard reader >= 0 else { throw PaliNoteBackupFileError.writeUnconfirmed }
      defer { if reader >= 0 { _ = Darwin.close(reader) } }
      var observed = stat()
      guard Darwin.fstat(reader, &observed) == 0, sameFile(observed, created) else { throw PaliNoteBackupFileError.writeUnconfirmed }
      let readBack = try read(reader, limit: data.count)
      guard readBack == data,
            Darwin.fstatat(parent, leaf, &observed, AT_SYMLINK_NOFOLLOW) == 0,
            sameFile(observed, created) else { throw PaliNoteBackupFileError.writeUnconfirmed }

      let writerClosed = Darwin.close(writer)
      writer = -1
      let readerClosed = Darwin.close(reader)
      reader = -1
      guard writerClosed == 0, readerClosed == 0 else { throw PaliNoteBackupFileError.writeUnconfirmed }
      try check()
      return readBack
    } catch {
      // Creation may have succeeded. The caller must explicitly resolve it.
      throw PaliNoteBackupFileError.writeUnconfirmed
    }
  }

  private static func sameFile(_ observed: stat, _ created: stat) -> Bool {
    isSingleRegularFile(observed) &&
      observed.st_dev == created.st_dev && observed.st_ino == created.st_ino
  }

  private static func isSingleRegularFile(_ info: stat) -> Bool {
    info.st_mode & S_IFMT == S_IFREG && info.st_nlink == 1
  }
}
