#if os(iOS)
import UIKit
import UserNotifications

/// A native transport for one generic watch confirmation. It owns no wallet state,
/// permissions policy, scheduling cadence, or notification data supplied by JavaScript.
@MainActor
final class PaliWatchNotice: NSObject, UNUserNotificationCenterDelegate {
  static let shared = PaliWatchNotice()

  private nonisolated static let prefix = "pali.watch-confirmation."
  private let center = UNUserNotificationCenter.current()
  private var activeID: String?
  private var adding = false

  private override init() {
    super.init()
  }

  enum Permission: String {
    case undecided, allowed, denied
  }

  enum Failure: Error {
    case invalidIdentifier, inactive, unavailable, superseded
  }

  func permission() async -> Permission {
    let settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined || settings.authorizationStatus == .provisional {
      return .undecided
    }
    guard settings.authorizationStatus == .authorized,
          settings.notificationCenterSetting == .enabled else { return .denied }
    return .allowed
  }

  /// After reading status, the caller checks the same explicit user action before
  /// invoking this prompt. Returned OS settings do not activate app consent.
  func requestPermission() async throws -> Permission {
    guard UIApplication.shared.applicationState == .active else { throw Failure.inactive }
    try Task.checkCancellation()
    _ = try await center.requestAuthorization(options: [.alert])
    return await permission()
  }

  /// Success acknowledges OS scheduling. It does not establish visibility.
  /// Callers retire their exact ID across wallet lock, selection, or lifecycle changes.
  func post(_ id: String) async throws {
    guard Self.isWatchID(id) else { throw Failure.invalidIdentifier }
    guard !adding, activeID == nil, UIApplication.shared.applicationState == .active else {
      throw Failure.inactive
    }
    // Reserve before the OS settings read; remove can retire it while suspended.
    activeID = id
    adding = true
    defer {
      adding = false
      releaseDelegateIfIdle()
    }
    do {
      try Task.checkCancellation()
      guard await permission() == .allowed,
            UIApplication.shared.applicationState == .active else { throw Failure.inactive }
      try Task.checkCancellation()
      guard activeID == id else { throw Failure.superseded }
      guard center.delegate == nil || center.delegate === self else { throw Failure.unavailable }
      center.delegate = self

      let content = UNMutableNotificationContent()
      content.title = "Watch Activity"
      content.body = "An explorer reports new confirmations."
      content.interruptionLevel = .passive
      try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
      try Task.checkCancellation()
      guard UIApplication.shared.applicationState == .active else { throw Failure.inactive }
      guard activeID == id, center.delegate === self else { throw Failure.superseded }
    } catch {
      // A late acknowledgement for this ID cannot remove a different notice.
      try? remove(id)
      throw error
    }
  }

  func remove(_ id: String) throws {
    guard Self.isWatchID(id) else { throw Failure.invalidIdentifier }
    if activeID == id { activeID = nil }
    center.removePendingNotificationRequests(withIdentifiers: [id])
    center.removeDeliveredNotifications(withIdentifiers: [id])
    releaseDelegateIfIdle()
  }

  private func releaseDelegateIfIdle() {
    if !adding && activeID == nil && center.delegate === self { center.delegate = nil }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    let id = notification.request.identifier
    guard notification.request.trigger == nil, Self.isWatchID(id) else { return [] }
    return await MainActor.run {
      activeID == id && self.center.delegate === self &&
        UIApplication.shared.applicationState == .active ? [.list] : []
    }
  }

  private nonisolated static func isWatchID(_ id: String) -> Bool {
    guard id.utf8.count == prefix.utf8.count + 32, id.hasPrefix(prefix) else { return false }
    return id.utf8.dropFirst(prefix.utf8.count).allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }
}
#endif
