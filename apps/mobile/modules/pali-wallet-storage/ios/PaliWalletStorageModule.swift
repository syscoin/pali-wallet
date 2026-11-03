import ExpoModulesCore
import Foundation
import Darwin

private final class WalletStorageLeaseState: @unchecked Sendable {
  static let shared = WalletStorageLeaseState()
  let mutex = NSLock()
  var token: String?
}

public final class PaliWalletStorageModule: Module {
  private let state = WalletStorageLeaseState.shared
  private let files = FileManager.default
  private let allowedNames: Set<String> = ["wallet.sqlite", "wallet.sqlite-wal", "wallet.sqlite-shm", "wallet.sqlite-journal"]

  private func failure() -> NSError {
    NSError(domain: "PaliWalletStorage", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "STORAGE_UNAVAILABLE"])
  }

  private func directory() throws -> URL {
    let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                appropriateFor: nil, create: true).resolvingSymlinksInPath()
    return support.appendingPathComponent("PaliWallet", isDirectory: true)
  }

  private func protect(_ url: URL, directory: Bool) throws {
    let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
    guard values.isSymbolicLink == false,
          directory ? values.isDirectory == true : values.isRegularFile == true else { throw failure() }
    try files.setAttributes([.protectionKey: FileProtectionType.complete,
                             .posixPermissions: directory ? 0o700 : 0o600], ofItemAtPath: url.path)
    var mutableURL = url
    var policy = URLResourceValues()
    policy.isExcludedFromBackup = true
    try mutableURL.setResourceValues(policy)
    let attributes = try files.attributesOfItem(atPath: url.path)
    let backup = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
    let protection = (attributes[.protectionKey] as? FileProtectionType)?.rawValue
      ?? (attributes[.protectionKey] as? String)
    let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
    guard protection == FileProtectionType.complete.rawValue,
          permissions == (directory ? 0o700 : 0o600),
          backup.isExcludedFromBackup == true else { throw failure() }
  }

  private func inspectDirectory(_ token: String) throws -> [String: Any] {
    guard state.token == token else { throw failure() }
    let directory = try directory()
    try protect(directory, directory: true)
    let children = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
    var present = false
    for child in children {
      guard allowedNames.contains(child.lastPathComponent) else { throw failure() }
      try protect(child, directory: false)
      let size = try child.resourceValues(forKeys: [.fileSizeKey]).fileSize
      guard let size, size <= 64 * 1024 * 1024 else { throw failure() }
      if child.lastPathComponent == "wallet.sqlite" { present = true }
    }
    // A WAL or journal without its database is not a fresh wallet.
    guard present || children.isEmpty else { throw failure() }
    return ["token": token, "directory": directory.path, "databaseExists": present]
  }

  public func definition() -> ModuleDefinition {
    Name("PaliWalletStorage")
    AsyncFunction("acquire") { () throws -> [String: Any] in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      guard self.state.token == nil else { throw self.failure() }
      let token = UUID().uuidString
      self.state.token = token
      do {
        let directory = try self.directory()
        if !self.files.fileExists(atPath: directory.path) {
          try self.files.createDirectory(at: directory, withIntermediateDirectories: false,
            attributes: [.protectionKey: FileProtectionType.complete, .posixPermissions: 0o700])
        }
        return try self.inspectDirectory(token)
      } catch {
        self.state.token = nil
        throw self.failure()
      }
    }
    AsyncFunction("inspect") { (token: String) throws -> [String: Any] in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      do { return try self.inspectDirectory(token) } catch { throw self.failure() }
    }
    AsyncFunction("createDatabase") { (token: String) throws in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      do {
        let before = try self.inspectDirectory(token)
        guard before["databaseExists"] as? Bool == false else { throw self.failure() }
        let database = try self.directory().appendingPathComponent("wallet.sqlite")
        // Atomic O_EXCL creation; never truncate an existing file.
        let descriptor = open(database.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw self.failure() }
        guard Darwin.close(descriptor) == 0 else { throw self.failure() }
        try self.protect(database, directory: false)
      } catch { throw self.failure() }
    }
    AsyncFunction("protect") { (token: String) throws in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      do { _ = try self.inspectDirectory(token) } catch { throw self.failure() }
    }
    AsyncFunction("release") { (token: String) throws in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      guard self.state.token == token else { throw self.failure() }
      self.state.token = nil
    }
  }
}
