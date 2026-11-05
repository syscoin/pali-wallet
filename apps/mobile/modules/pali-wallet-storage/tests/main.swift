import Darwin
import Foundation

let files = FileManager.default
let directory = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
try files.createDirectory(at: directory, withIntermediateDirectories: false)
defer { try? files.removeItem(at: directory) }

let cap = 8_388_688
let marker = Data("PALINOTE".utf8)
var passed = 0

func check(_ name: String, _ test: () throws -> Bool) rethrows {
  guard try test() else { fatalError("Failed: \(name)") }
  passed += 1
  print("PASS \(name)")
}

func makeFile(_ name: String, _ data: Data) throws -> URL {
  let url = directory.appendingPathComponent(name)
  try data.write(to: url)
  return url
}

func framedBytes(_ count: Int) -> Data {
  marker + Data(repeating: 0x42, count: count - marker.count)
}

func refuses(_ url: URL, _ expected: PaliNoteBackupFileError) throws -> Bool {
  do { _ = try PaliNoteBackupFile.read(url); return false }
  catch let error as PaliNoteBackupFileError { return error == expected }
}

let small = framedBytes(80)
let accepted = try makeFile("fixture.palibak", small)
try check("returns only exact file bytes") { try PaliNoteBackupFile.read(accepted) == small }

let maximum = framedBytes(cap)
let atLimit = try makeFile("exact-limit.palibak", maximum)
try check("accepts a file exactly at the shared cap") { try PaliNoteBackupFile.read(atLimit) == maximum }

let oversized = try makeFile("sparse-oversize.palibak", marker)
let sized = oversized.withUnsafeFileSystemRepresentation { path in
  Darwin.truncate(path!, off_t(cap + 1))
}
precondition(sized == 0)
try check("rejects one byte over the cap") { try refuses(oversized, .tooLarge) }

let symlink = directory.appendingPathComponent("symbolic.palibak")
try files.createSymbolicLink(at: symlink, withDestinationURL: accepted)
try check("never follows a final-component symlink to an accepted file") { try refuses(symlink, .unavailable) }

let fifo = directory.appendingPathComponent("pipe.palibak")
let madePipe = fifo.withUnsafeFileSystemRepresentation { Darwin.mkfifo($0!, 0o600) }
precondition(madePipe == 0)
try check("rejects an unwritten FIFO without blocking") { try refuses(fifo, .invalid) }
try check("rejects a directory") { try refuses(directory, .invalid) }

let plaintext = try makeFile("plain.palibak", Data(repeating: 0x41, count: 100))
try check("refuses a plaintext file with the backup extension") { try refuses(plaintext, .invalid) }
let short = try makeFile("truncated.palibak", marker)
try check("rejects a marker without minimum framing") { try refuses(short, .invalid) }
try check("rejects missing and non-file URLs") {
  try refuses(directory.appendingPathComponent("missing.palibak"), .unavailable)
    && refuses(URL(string: "https://invalid.invalid/fixture.palibak")!, .invalid)
}

func exportBytes(_ count: Int) -> Data {
  var data = framedBytes(count)
  data.replaceSubrange(8..<12, with: [1, 1, 1, 0])
  data.replaceSubrange(60..<64, with: [0, 0, 0, 0])
  let length = count - 64
  for index in 0..<4 {
    data[56 + index] = UInt8(truncatingIfNeeded: length >> ((3 - index) * 8))
  }
  return data
}

func exportURL(_ id: UUID, in folder: URL = directory) -> URL {
  folder.appendingPathComponent("pali-private-notes-\(id.uuidString.lowercased()).palibak")
}

func rejects(_ expected: PaliNoteBackupFileError, _ operation: () throws -> Void) throws -> Bool {
  do { try operation(); return false }
  catch let error as PaliNoteBackupFileError { return error == expected }
}

let payload = exportBytes(80)
let identity = UUID()
let written = exportURL(identity)
try check("exports and independently reads exactly the original encrypted bytes") {
  try PaliNoteBackupFile.write(payload, in: directory, nameId: identity, check: {}) == payload
    && Data(contentsOf: written) == payload
}
let maximumExport = exportBytes(cap)
try check("export accepts the exact shared byte cap") {
  try PaliNoteBackupFile.write(maximumExport, in: directory, check: {}) == maximumExport
}

try check("rejects oversized and malformed v1 framing before creating any file") {
  let blocked = UUID()
  var invalid = [framedBytes(80), marker, Data(repeating: 0x41, count: 80)]
  for offset in [8, 9, 10, 11, 59, 63] {
    var malformed = payload
    malformed[offset] ^= 1
    invalid.append(malformed)
  }
  for bytes in invalid {
    guard try rejects(.invalid, { _ = try PaliNoteBackupFile.write(bytes, in: directory, nameId: blocked, check: {}) }) else { return false }
  }
  return try rejects(.tooLarge, { _ = try PaliNoteBackupFile.write(exportBytes(cap + 1), in: directory, nameId: blocked, check: {}) })
    && !files.fileExists(atPath: exportURL(blocked).path)
}

try check("exclusive creation preserves an existing regular file") {
  var changed = payload
  changed[changed.count - 1] ^= 1
  return try rejects(.unavailable, { _ = try PaliNoteBackupFile.write(changed, in: directory, nameId: identity, check: {}) })
    && Data(contentsOf: written) == payload
}

try check("exclusive creation refuses an existing symlink without touching its target") {
  let occupied = UUID()
  let alias = exportURL(occupied)
  try files.createSymbolicLink(at: alias, withDestinationURL: written)
  return try rejects(.unavailable, { _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: occupied, check: {}) })
    && files.destinationOfSymbolicLink(atPath: alias.path) == written.path
    && Data(contentsOf: written) == payload
}

try check("refuses a selected directory symlink and non-directory target") {
  let id = UUID()
  let alias = directory.appendingPathComponent("directory-alias", isDirectory: true)
  try files.createSymbolicLink(at: alias, withDestinationURL: directory)
  return try rejects(.unavailable, { _ = try PaliNoteBackupFile.write(payload, in: alias, nameId: id, check: {}) })
    && rejects(.unavailable, { _ = try PaliNoteBackupFile.write(payload, in: written, nameId: id, check: {}) })
    && !files.fileExists(atPath: exportURL(id).path)
}

try check("revocation before creation leaves no file") {
  let id = UUID()
  return try rejects(.unavailable, {
    _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: id) { throw PaliNoteBackupFileError.unavailable }
  }) && !files.fileExists(atPath: exportURL(id).path)
}

try check("revocation after creation preserves the partial file and forbids overwriting it") {
  let id = UUID()
  let output = exportURL(id)
  return try rejects(.writeUnconfirmed, {
    _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: id) {
      if files.fileExists(atPath: output.path) { throw PaliNoteBackupFileError.unavailable }
    }
  }) && Data(contentsOf: output).isEmpty
    && rejects(.unavailable, { _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: id, check: {}) })
    && Data(contentsOf: output).isEmpty
}

try check("readback refuses changed bytes without deleting the written item") {
  let id = UUID()
  let output = exportURL(id)
  var changed = payload
  changed[changed.count - 1] ^= 1
  var changedAfterWrite = false
  return try rejects(.writeUnconfirmed, {
    _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: id) {
      if !changedAfterWrite, (try? Data(contentsOf: output)) == payload {
        changedAfterWrite = true
        try changed.write(to: output)
      }
    }
  }) && changedAfterWrite && Data(contentsOf: output) == changed
}

for symbolic in [false, true] {
  try check("readback refuses \(symbolic ? "a symlink" : "a new inode") even if the bytes match") {
    let id = UUID()
    let output = exportURL(id)
    let moved = directory.appendingPathComponent(UUID().uuidString)
    var replaced = false
    return try rejects(.writeUnconfirmed, {
      _ = try PaliNoteBackupFile.write(payload, in: directory, nameId: id) {
        if !replaced, (try? Data(contentsOf: output)) == payload {
          replaced = true
          try files.moveItem(at: output, to: moved)
          if symbolic { try files.createSymbolicLink(at: output, withDestinationURL: moved) }
          else { try payload.write(to: output) }
        }
      }
    }) && replaced && Data(contentsOf: output) == payload && Data(contentsOf: moved) == payload
  }
}

try check("a destination belongs to one owner, can be used once, and can be revoked") {
  let owner = PaliNoteBackupPickerOwner()
  let token = PaliNoteBackupDestination(owner: owner, directory: directory, now: 10)
  guard token.matches(owner, token.token),
        !token.matches(PaliNoteBackupPickerOwner(), token.token),
        !token.matches(owner, UUID().uuidString),
        try rejects(.unavailable, { try token.check(now: 10) }) else { return false }
  try token.begin(now: 11)
  try token.check(now: 12)
  guard try rejects(.unavailable, { try token.begin(now: 12) }) else { return false }
  token.revoke()
  return try rejects(.unavailable, { try token.check(now: 13) })
}

try check("destination expiry and owner destruction prevent an admitted result") {
  let owner = PaliNoteBackupPickerOwner()
  let lifetime = UInt64(PaliNoteBackupDestination.lifetimeSeconds) * 1_000_000_000
  let expired = PaliNoteBackupDestination(owner: owner, directory: directory, now: 10)
  guard try rejects(.unavailable, { try expired.begin(now: 10 + lifetime) }) else { return false }
  let writing = PaliNoteBackupDestination(owner: owner, directory: directory, now: 11)
  try writing.begin(now: 11)
  guard try rejects(.unavailable, { try writing.check(now: 11 + lifetime) }) else { return false }
  owner.retire()
  return try rejects(.unavailable, { try writing.check(now: 12) })
}
print("\(passed)/\(passed) synthetic file checks passed")
