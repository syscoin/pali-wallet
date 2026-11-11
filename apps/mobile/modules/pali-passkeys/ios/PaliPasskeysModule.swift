import ExpoModulesCore
import Foundation
import UIKit

private final class PaliPasskeyException: Exception {
  private let failure: PaliPasskeyFailure
  init(_ failure: PaliPasskeyFailure) { self.failure = failure; super.init() }
  override var code: String { failure.rawValue }
  override var reason: String { "Passkey operation unavailable" }
}

public final class PaliPasskeysModule: Module {
  private let requests = PaliPasskeyRequests()
  // Accessed only on the main queue; the registry revokes authority synchronously.
  @MainActor private var ceremony: PaliPasskeyCeremony?

  public func definition() -> ModuleDefinition {
    Name("PaliPasskeys")
    Function("getContext") { ["rpId": PaliPasskeyPolicy.rpId, "origin": PaliPasskeyPolicy.origin] }
    Function("prepare") { () throws -> String in
      guard #available(iOS 16.0, *) else { throw PaliPasskeyException(.unavailable) }
      do { return try self.requests.prepare() }
      catch { throw PaliPasskeyException(error as? PaliPasskeyFailure ?? .unavailable) }
    }
    Function("cancel") { (id: String) -> Bool in
      let result = self.requests.cancel(id)
      if let ticket = result.active {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.cancel(ticket) } }
      }
      return result.cancelled
    }
    AsyncFunction("create") { (id: String, json: String, promise: Promise) in
      MainActor.assumeIsolated { self.begin(id: id, json: json, kind: .create, promise: promise) }
    }.runOnQueue(.main)
    AsyncFunction("get") { (id: String, json: String, promise: Promise) in
      MainActor.assumeIsolated { self.begin(id: id, json: json, kind: .get, promise: promise) }
    }.runOnQueue(.main)
    OnAppEntersBackground { self.revoke() }
    OnAppContextDestroys { self.revoke(close: true) }
    OnDestroy { self.revoke(close: true) }
  }

  @MainActor private func begin(id: String, json: String, kind: PaliPasskeyRequest.Kind, promise: Promise) {
    guard #available(iOS 16.0, *) else { promise.reject(PaliPasskeyException(.unavailable)); return }
    let ticket: PaliPasskeyRequests.Ticket
    do { ticket = try requests.claim(id) }
    catch { promise.reject(PaliPasskeyException(error as? PaliPasskeyFailure ?? .cancelled)); return }
    do {
      let request = try PaliPasskeyRequest(json: json, kind: kind)
      guard requests.isCurrent(ticket), let presenter = appContext?.utilities?.currentViewController()
        else { throw PaliPasskeyFailure.cancelled }
      let ceremony = try PaliPasskeyCeremony(request: request, ticket: ticket, requests: requests, presenter: presenter) { [weak self] result in
        if self?.ceremony?.owns(ticket) == true { self?.ceremony = nil }
        switch result {
        case .success(let json): promise.resolve(json)
        case .failure(let failure): promise.reject(PaliPasskeyException(failure))
        }
      }
      self.ceremony = ceremony
      ceremony.start()
    } catch {
      requests.finish(ticket)
      promise.reject(PaliPasskeyException(error as? PaliPasskeyFailure ?? .failed))
    }
  }

  @MainActor private func cancel(_ ticket: PaliPasskeyRequests.Ticket) {
    // A delayed cancellation can never target a newer controller.
    guard #available(iOS 16.0, *), !requests.isCurrent(ticket), ceremony?.owns(ticket) == true else { return }
    ceremony?.cancel()
  }

  private func revoke(close: Bool = false) {
    if let ticket = requests.revokeAll(close: close) {
      DispatchQueue.main.async { MainActor.assumeIsolated { self.cancel(ticket) } }
    }
  }
}
