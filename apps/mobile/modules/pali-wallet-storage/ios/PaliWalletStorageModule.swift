import ExpoModulesCore
import Foundation
import Darwin

private enum WalletStoragePolicyStage: String {
  case leaseAcquire = "PALI_STORAGE_POLICY_LEASE_ACQUIRE"
  case leaseValidate = "PALI_STORAGE_POLICY_LEASE_VALIDATE"
  case leaseRelease = "PALI_STORAGE_POLICY_LEASE_RELEASE"
  case directoryResolve = "PALI_STORAGE_POLICY_DIRECTORY_RESOLVE"
  case directoryCreate = "PALI_STORAGE_POLICY_DIRECTORY_CREATE"
  case resourceRead = "PALI_STORAGE_POLICY_RESOURCE_READ"
  case symlinkCheck = "PALI_STORAGE_POLICY_SYMLINK_CHECK"
  case typeCheck = "PALI_STORAGE_POLICY_TYPE_CHECK"
  case protectionWrite = "PALI_STORAGE_POLICY_PROTECTION_WRITE"
  case backupWrite = "PALI_STORAGE_POLICY_BACKUP_WRITE"
  case attributesRead = "PALI_STORAGE_POLICY_ATTRIBUTES_READ"
  case backupRead = "PALI_STORAGE_POLICY_BACKUP_READ"
  case protectionCheck = "PALI_STORAGE_POLICY_PROTECTION_CHECK"
  case permissionsCheck = "PALI_STORAGE_POLICY_PERMISSIONS_CHECK"
  case backupCheck = "PALI_STORAGE_POLICY_BACKUP_CHECK"
  case directoryList = "PALI_STORAGE_POLICY_DIRECTORY_LIST"
  case childName = "PALI_STORAGE_POLICY_CHILD_NAME"
  case fileSize = "PALI_STORAGE_POLICY_FILE_SIZE"
  case orphanSidecars = "PALI_STORAGE_POLICY_ORPHAN_SIDECARS"
  case databaseAbsent = "PALI_STORAGE_POLICY_DATABASE_ABSENT"
  case databaseCreate = "PALI_STORAGE_POLICY_DATABASE_CREATE"
  case databaseClose = "PALI_STORAGE_POLICY_DATABASE_CLOSE"
}

private final class WalletStoragePolicyException: Exception {
  private let stage: WalletStoragePolicyStage
  init(_ stage: WalletStoragePolicyStage) {
    self.stage = stage
    super.init()
  }
  override var code: String { stage.rawValue }
  override var reason: String { "STORAGE_UNAVAILABLE" }
}

private final class WalletStorageLeaseState: @unchecked Sendable {
  static let shared = WalletStorageLeaseState()
  let mutex = NSLock()
  var token: String?
}

public final class PaliWalletStorageModule: Module {
  private let state = WalletStorageLeaseState.shared
  private let files = FileManager.default
  private let allowedNames: Set<String> = ["wallet.sqlite", "wallet.sqlite-wal", "wallet.sqlite-shm", "wallet.sqlite-journal"]
  // Accessed only while holding the shared lease mutex; captured by value in errors.
  private var failureStage: WalletStoragePolicyStage = .leaseAcquire

  private func failure() -> WalletStoragePolicyException {
    WalletStoragePolicyException(failureStage)
  }

  private func directory() throws -> URL {
    failureStage = .directoryResolve
    let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                appropriateFor: nil, create: true).resolvingSymlinksInPath()
    return support.appendingPathComponent("PaliWallet", isDirectory: true)
  }

  private func protect(_ url: URL, directory: Bool) throws {
    failureStage = .resourceRead
    let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
    failureStage = .symlinkCheck
    guard values.isSymbolicLink == false else { throw failure() }
    failureStage = .typeCheck
    guard directory ? values.isDirectory == true : values.isRegularFile == true else { throw failure() }
    failureStage = .protectionWrite
    try files.setAttributes([.protectionKey: FileProtectionType.complete,
                             .posixPermissions: directory ? 0o700 : 0o600], ofItemAtPath: url.path)
    var mutableURL = url
    var policy = URLResourceValues()
    policy.isExcludedFromBackup = true
    failureStage = .backupWrite
    try mutableURL.setResourceValues(policy)
    failureStage = .attributesRead
    let attributes = try files.attributesOfItem(atPath: url.path)
    failureStage = .backupRead
    let backup = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
    let protection = (attributes[.protectionKey] as? FileProtectionType)?.rawValue
      ?? (attributes[.protectionKey] as? String)
    let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue
    failureStage = .protectionCheck
    guard protection == FileProtectionType.complete.rawValue else { throw failure() }
    failureStage = .permissionsCheck
    guard permissions == (directory ? 0o700 : 0o600) else { throw failure() }
    failureStage = .backupCheck
    guard backup.isExcludedFromBackup == true else { throw failure() }
  }

  private func inspectDirectory(_ token: String) throws -> [String: Any] {
    failureStage = .leaseValidate
    guard state.token == token else { throw failure() }
    let directory = try directory()
    try protect(directory, directory: true)
    failureStage = .directoryList
    let children = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
    var present = false
    for child in children {
      failureStage = .childName
      guard allowedNames.contains(child.lastPathComponent) else { throw failure() }
      try protect(child, directory: false)
      failureStage = .fileSize
      let size = try child.resourceValues(forKeys: [.fileSizeKey]).fileSize
      guard let size, size <= 64 * 1024 * 1024 else { throw failure() }
      if child.lastPathComponent == "wallet.sqlite" { present = true }
    }
    // A WAL or journal without its database is not a fresh wallet.
    failureStage = .orphanSidecars
    guard present || children.isEmpty else { throw failure() }
    return ["token": token, "directory": directory.path, "databaseExists": present]
  }

  public func definition() -> ModuleDefinition {
    Name("PaliWalletStorage")
    AsyncFunction("acquire") { () throws -> [String: Any] in
      self.state.mutex.lock()
      defer { self.state.mutex.unlock() }
      self.failureStage = .leaseAcquire
      guard self.state.token == nil else { throw self.failure() }
      let token = UUID().uuidString
      self.state.token = token
      do {
        let directory = try self.directory()
        if !self.files.fileExists(atPath: directory.path) {
          self.failureStage = .directoryCreate
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
        self.failureStage = .databaseAbsent
        guard before["databaseExists"] as? Bool == false else { throw self.failure() }
        let database = try self.directory().appendingPathComponent("wallet.sqlite")
        // Atomic O_EXCL creation; never truncate an existing file.
        self.failureStage = .databaseCreate
        let descriptor = open(database.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw self.failure() }
        self.failureStage = .databaseClose
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
      self.failureStage = .leaseRelease
      guard self.state.token == token else { throw self.failure() }
      self.state.token = nil
    }
  }
}
