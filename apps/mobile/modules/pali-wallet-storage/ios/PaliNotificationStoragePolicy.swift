import Foundation
import Darwin

/** Public alert metadata has its own directory and availability class.
 * The spending wallet's Complete-protection policy is intentionally untouched. */
enum PaliNotificationStoragePolicy {
  private static let lock = NSLock()
  private static let names: Set<String> = ["activity-notifications.sqlite", "activity-notifications.sqlite-wal", "activity-notifications.sqlite-shm", "activity-notifications.sqlite-journal"]
  private static func invalid() -> NSError { NSError(domain: "PaliActivityNotifications", code: 1) }
  private static func location() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
    return base.appendingPathComponent("PaliActivityNotifications", isDirectory: true)
  }
  private static func protect(_ url: URL, directory: Bool) throws {
    let files = FileManager.default
    let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey, .fileSizeKey])
    guard values.isSymbolicLink == false, directory ? values.isDirectory == true : values.isRegularFile == true,
          directory || (values.fileSize ?? Int.max) <= 32 * 1024 * 1024 else { throw invalid() }
    try files.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
      .posixPermissions: directory ? 0o700 : 0o600], ofItemAtPath: url.path)
    var target = url
    var backup = URLResourceValues(); backup.isExcludedFromBackup = true
    try target.setResourceValues(backup); target.removeAllCachedResourceValues()
    let verified = try target.resourceValues(forKeys: [.fileProtectionKey, .isExcludedFromBackupKey])
    let attrs = try files.attributesOfItem(atPath: url.path)
    guard verified.fileProtection == .completeUntilFirstUserAuthentication,
          verified.isExcludedFromBackup == true,
          (attrs[.posixPermissions] as? NSNumber)?.intValue == (directory ? 0o700 : 0o600) else { throw invalid() }
  }
  static func prepare(create: Bool) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    let files = FileManager.default, directory = try location()
    if !files.fileExists(atPath: directory.path) {
      if !create { return ["directory": directory.path, "databaseExists": false] }
      try files.createDirectory(at: directory, withIntermediateDirectories: false,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication, .posixPermissions: 0o700])
    }
    try protect(directory, directory: true)
    let children = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    for child in children {
      guard names.contains(child.lastPathComponent) else { throw invalid() }
      try protect(child, directory: false)
    }
    let target = directory.appendingPathComponent("activity-notifications.sqlite")
    let existed = files.fileExists(atPath: target.path)
    guard existed || children.isEmpty else { throw invalid() }
    if create && !existed {
      let descriptor = open(target.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
      guard descriptor >= 0 else { throw invalid() }
      guard close(descriptor) == 0 else { throw invalid() }
      try protect(target, directory: false)
    }
    return ["directory": directory.path, "databaseExists": existed]
  }
}
