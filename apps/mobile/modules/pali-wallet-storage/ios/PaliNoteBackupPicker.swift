#if os(iOS)
import ExpoModulesCore
import Foundation
import UIKit
import UniformTypeIdentifiers

@MainActor
final class PaliNoteBackupPicker: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  static let shared = PaliNoteBackupPicker()

  private enum Kind {
    case importFile, exportDirectory, write(PaliNoteBackupDestination)
  }

  private struct Request {
    let owner: PaliNoteBackupPickerOwner
    let id = UUID()
    let kind: Kind
    var picker: UIDocumentPickerViewController?
    var promise: Promise?
  }
  private var pending: Request?
  private var destination: PaliNoteBackupDestination?

  func pick(owner: PaliNoteBackupPickerOwner, presenter: UIViewController?, promise: Promise) {
    // Allow binary files with an unregistered extension; read and admit bytes ourselves.
    present(.data, kind: .importFile, owner: owner, presenter: presenter, promise: promise)
  }

  func pickDestination(owner: PaliNoteBackupPickerOwner, presenter: UIViewController?, promise: Promise) {
    present(.folder, kind: .exportDirectory, owner: owner, presenter: presenter, promise: promise)
  }

  private func present(_ type: UTType, kind: Kind, owner: PaliNoteBackupPickerOwner, presenter: UIViewController?, promise: Promise) {
    guard pending == nil else { reject(promise, .busy); return }
    guard owner.isActive, let presenter, presenter.viewIfLoaded?.window != nil,
          presenter.presentedViewController == nil, !presenter.isBeingDismissed else {
      reject(promise, .unavailable)
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [type], asCopy: false)
    picker.allowsMultipleSelection = false
    picker.modalPresentationStyle = .pageSheet
    picker.delegate = self
    picker.presentationController?.delegate = self
    pending = Request(owner: owner, kind: kind, picker: picker, promise: promise)
    presenter.present(picker, animated: true)
  }

  func write(owner: PaliNoteBackupPickerOwner, token: String, bytes: Data, promise: Promise) {
    guard let selected = destination, selected.matches(owner, token) else {
      reject(promise, .unavailable)
      return
    }
    destination = nil
    guard pending == nil else { selected.revoke(); reject(promise, .busy); return }
    do { try selected.begin() }
    catch { reject(promise, .unavailable); return }

    let request = Request(owner: owner, kind: .write(selected), promise: promise)
    pending = request
    let id = request.id
    DispatchQueue.global(qos: .userInitiated).async {
      let result = Self.writeCoordinated(selected, bytes: bytes)
      DispatchQueue.main.async { self.finish(id, result) }
    }
  }

  func revokeDestination(owner: PaliNoteBackupPickerOwner, token: String) {
    if let selected = destination, selected.matches(owner, token) {
      selected.revoke()
      destination = nil
    }
    if let request = pending, case .write(let selected) = request.kind, selected.matches(owner, token) {
      selected.revoke()
      abandon(request, error: .writeUnconfirmed)
    }
  }

  func invalidate(owner: PaliNoteBackupPickerOwner) {
    if let selected = destination, selected.owner === owner {
      selected.revoke()
      destination = nil
    }
    guard let request = pending, request.owner === owner else { return }
    switch request.kind {
    case .importFile: abandon(request, error: nil)
    case .exportDirectory: abandon(request, error: .unavailable)
    case .write(let selected):
      selected.revoke()
      abandon(request, error: .writeUnconfirmed)
    }
  }

  private func abandon(_ request: Request, error: PaliNoteBackupFileError?) {
    if let picker = request.picker {
      pending = nil
      picker.delegate = nil
      picker.presentationController?.delegate = nil
      picker.dismiss(animated: false)
    } else {
      // The provider operation must drain before another request can take its slot.
      pending?.promise = nil
    }
    if let error, let promise = request.promise { reject(promise, error) }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let request = pending, request.picker === controller else { return }
    guard urls.count == 1, let url = urls.first else {
      finish(request.id, .failure(.invalid))
      return
    }
    if case .exportDirectory = request.kind {
      guard request.owner.isActive, url.isFileURL, let promise = request.promise else {
        finish(request.id, .failure(.unavailable))
        return
      }
      pending = nil
      destination?.revoke()
      let owner = request.owner
      let selected = PaliNoteBackupDestination(owner: owner, directory: url)
      destination = selected
      let token = selected.token
      DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(PaliNoteBackupDestination.lifetimeSeconds)) { [weak self] in
        self?.revokeDestination(owner: owner, token: token)
      }
      promise.resolve(token)
      return
    }
    pending?.picker = nil
    let id = request.id
    DispatchQueue.global(qos: .userInitiated).async {
      let result = Self.readCoordinated(url)
      DispatchQueue.main.async { self.finish(id, result) }
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard let request = pending, request.picker === controller else { return }
    finish(request.id, .success(nil))
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard let picker = presentationController.presentedViewController as? UIDocumentPickerViewController else { return }
    documentPickerWasCancelled(picker)
  }

  private func finish(_ id: UUID, _ result: Result<Data?, PaliNoteBackupFileError>) {
    guard let request = pending, request.id == id else { return }
    pending = nil
    guard let promise = request.promise else { return }
    switch request.kind {
    case .importFile: guard request.owner.isActive else { return }
    case .exportDirectory: guard request.owner.isActive else { reject(promise, .unavailable); return }
    case .write(let selected):
      do { try selected.check() }
      catch { reject(promise, .writeUnconfirmed); return }
    }
    switch result {
    case .success(let data):
      if let data { promise.resolve(data) } else { promise.resolve() }
    case .failure(let error): reject(promise, error)
    }
  }

  private func reject(_ promise: Promise, _ error: PaliNoteBackupFileError) {
    promise.reject(error.rawValue, error.rawValue)
  }

  private nonisolated static func readCoordinated(_ url: URL) -> Result<Data?, PaliNoteBackupFileError> {
    guard url.isFileURL, url.startAccessingSecurityScopedResource() else { return .failure(.unavailable) }
    defer { url.stopAccessingSecurityScopedResource() }
    var result: Result<Data?, PaliNoteBackupFileError> = .failure(.unavailable)
    var coordinatorError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordinatorError) { coordinated in
      do { result = .success(try PaliNoteBackupFile.read(coordinated)) }
      catch let error as PaliNoteBackupFileError { result = .failure(error) }
      catch { result = .failure(.unavailable) }
    }
    return coordinatorError == nil ? result : .failure(.unavailable)
  }

  private nonisolated static func writeCoordinated(_ selected: PaliNoteBackupDestination, bytes: Data) -> Result<Data?, PaliNoteBackupFileError> {
    do {
      try PaliNoteBackupFile.validateExport(bytes)
      try selected.check()
    } catch let error as PaliNoteBackupFileError { return .failure(error) }
    catch { return .failure(.unavailable) }
    let directory = selected.directory
    guard directory.startAccessingSecurityScopedResource() else { return .failure(.unavailable) }
    defer { directory.stopAccessingSecurityScopedResource() }
    var result: Result<Data?, PaliNoteBackupFileError> = .failure(.unavailable)
    var coordinatorError: NSError?
    NSFileCoordinator().coordinate(writingItemAt: directory, options: [], error: &coordinatorError) { coordinated in
      do {
        result = .success(try PaliNoteBackupFile.write(bytes, in: coordinated) { try selected.check() })
      } catch let error as PaliNoteBackupFileError { result = .failure(error) }
      catch { result = .failure(.unavailable) }
    }
    guard coordinatorError != nil else { return result }
    switch result {
    case .success, .failure(.writeUnconfirmed): return .failure(.writeUnconfirmed)
    case .failure: return .failure(.unavailable)
    }
  }
}
#endif
