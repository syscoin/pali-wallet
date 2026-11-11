import ExpoModulesCore
import Foundation
import UIKit

private final class PaliCryptoOperationException: Exception {
  override var reason: String { "Native cryptographic operation failed" }
}
private final class WeakKey { weak var key: PaliCryptoKey?; init(_ key: PaliCryptoKey) { self.key = key } }

final class PaliCryptoKey: SharedObject {
  let owner: PaliCryptoContext
  private let kind: String
  private let usages: Set<String>
  private let mutex = NSLock()
  private var material: Data?

  init(owner: PaliCryptoContext, kind: String, usages: [String], material: Data) {
    self.owner = owner; self.kind = kind; self.usages = Set(usages)
    self.material = material.withUnsafeBytes { $0.isEmpty ? Data() : Data(bytes: $0.baseAddress!, count: $0.count) }
    super.init()
  }

  func copyMaterial(owner: PaliCryptoContext, kind: String, usage: String) throws -> Data {
    guard self.owner === owner else { throw PaliCryptoFailure.invalidInput }
    try owner.ensureOpen()
    mutex.lock(); defer { mutex.unlock() }
    guard self.kind == kind, usages.contains(usage), let material else { throw PaliCryptoFailure.invalidInput }
    return material.withUnsafeBytes { $0.isEmpty ? Data() : Data(bytes: $0.baseAddress!, count: $0.count) }
  }

  func isUsable(owner: PaliCryptoContext, kind: String, usage: String) -> Bool {
    mutex.lock(); defer { mutex.unlock() }
    return self.owner === owner && self.kind == kind && usages.contains(usage) && material != nil
  }

  func destroy() {
    mutex.lock(); defer { mutex.unlock() }
    let count = material?.count ?? 0
    material?.resetBytes(in: 0..<count); material = nil
  }
  override func sharedObjectDidRelease() { destroy() }
  override func getAdditionalMemoryPressure() -> Int {
    mutex.lock(); defer { mutex.unlock() }
    return material?.count ?? 0
  }
  deinit { destroy() }
}

final class PaliCryptoContext: SharedObject {
  private let mutex = NSLock()
  private var closed = false
  private var keys: [WeakKey] = []

  func ensureOpen() throws {
    mutex.lock(); defer { mutex.unlock() }
    if closed { throw PaliCryptoFailure.closed }
  }

  func importKey(_ kind: String, _ usages: [String], _ data: Data) throws -> PaliCryptoKey {
    let allowed: Set<String> = kind == "AES-GCM" ? ["encrypt", "decrypt"] : kind == "HMAC-SHA512" ? ["sign"] : ["deriveBits", "deriveKey"]
    guard ["AES-GCM", "PBKDF2", "HKDF", "HMAC-SHA512"].contains(kind), !usages.isEmpty,
          usages.count <= 2, Set(usages).count == usages.count,
          Set(usages).isSubset(of: allowed), data.count <= 4_096,
          kind != "AES-GCM" || data.count == 32,
          (kind != "HKDF" && kind != "HMAC-SHA512") || !data.isEmpty else { throw PaliCryptoFailure.invalidInput }
    return try registerKey(kind, usages, data)
  }

  fileprivate func importPublicSlhFixtureSeed() throws -> PaliCryptoKey {
    var data = Data(bytes: pali_slh_qualification_seed(), count: Int(PALI_SLH_SEED_BYTES))
    defer { data.resetBytes(in: 0..<data.count) }
    return try registerKey("SLH-DSA-SEED", ["derivePublic"], data)
  }
  func importSlhMaterial(_ data: Data, seed: Bool) throws -> PaliCryptoKey {
    guard data.count == (seed ? 48 : 64) else { throw PaliCryptoFailure.invalidInput }
    return try registerKey(seed ? "SLH-DSA-SEED" : "SLH-DSA-SK", [seed ? "derivePublic" : "sign"], data)
  }

  private func registerKey(_ kind: String, _ usages: [String], _ data: Data) throws -> PaliCryptoKey {
    mutex.lock(); defer { mutex.unlock() }
    if closed { throw PaliCryptoFailure.closed }
    keys.removeAll { $0.key == nil }
    let key = PaliCryptoKey(owner: self, kind: kind, usages: usages, material: data)
    keys.append(WeakKey(key))
    return key
  }

  func usingKey<T>(_ key: PaliCryptoKey, kind: String, usage: String, _ body: (Data) throws -> T) throws -> T {
    var material = try key.copyMaterial(owner: self, kind: kind, usage: usage)
    defer { material.resetBytes(in: material.startIndex..<material.endIndex) }
    let result = try body(material)
    try ensureOpen()
    return result
  }

  func close() {
    mutex.lock()
    closed = true
    let live = keys.compactMap { $0.key }; keys.removeAll()
    mutex.unlock()
    live.forEach { $0.destroy() }
  }
  override func sharedObjectDidRelease() { close() }
  deinit { close() }
}

private struct PaliDecryptResponse: Record {
  @Field var status = "authentication-rejected"
  @Field var data: Data? = nil
}

public final class PaliWalletCryptoModule: Module {
  private static let slhQualificationBundles: Set<String> = [
    "com.paliwallet.qualification",
    "com.paliwallet.qualification.physical.import",
    "com.paliwallet.qualification.physical.generate",
    "com.paliwallet.qualification.physical.slh",
  ]
  private let queue = DispatchQueue(label: "org.paliwallet.crypto", qos: .userInitiated)
  private let publicMerkleOwner = PaliPublicMerkleBatchOwner()
  private let slhOwner = PaliSlhOperationOwner()
  private let slhQualificationResources = PaliSlhQualificationResources()

  private func operation<T>(_ body: () throws -> T) throws -> T {
    do { return try body() } catch { throw PaliCryptoOperationException() }
  }
  private func slhForeground() -> Bool {
    if Thread.isMainThread { return UIApplication.shared.applicationState == .active }
    return DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
  }
  private func slhResourceDefinition(_ make: @autoclosure () -> AnyDefinition) -> AnyDefinition {
    // Expo's module builder has no conditional branches. Its empty definition
    // exports nothing; do not even construct these functions in other bundles.
    guard Bundle.main.bundleIdentifier == PaliSlhQualificationResources.bundleIdentifier else {
      return ModuleDefinitionBuilder.buildBlock()
    }
    return make()
  }

  public func definition() -> ModuleDefinition {
    Name("PaliWalletCrypto")
    Function("info") { ["apiVersion": 1, "implementation": "apple-cryptokit-commoncrypto"] as [String: Any] }
    Function("createContext") { PaliCryptoContext() }
    Function("slhParallelism") { PaliSlhLeafWorker.shared.parallelism }
    Function("createSlhContext") { (namespace: String) in try self.operation {
      guard self.slhForeground() else { throw PaliSlhFailure.unavailable }
      return try PaliSlhContext(namespace: namespace, owner: self.slhOwner)
    } }
    Function("prepareSlhCachePurge") { (namespace: String) in try self.operation {
      guard self.slhForeground() else { throw PaliSlhFailure.unavailable }
      return try PaliSlhCachePurge(namespace: namespace, owner: self.slhOwner)
    } }
    OnDestroy { self.publicMerkleOwner.retire(); self.slhOwner.retire(); self.slhQualificationResources.cancel(dispose: true) }
    OnAppContextDestroys { self.slhQualificationResources.cancel(dispose: true) }
    OnAppEntersBackground { self.slhOwner.background(); self.slhQualificationResources.cancel() }
    OnAppEntersForeground { self.slhOwner.resume() }
    slhResourceDefinition(Function("beginSlhQualificationResources") { () throws -> String in
        guard self.slhForeground() else { throw PaliSlhFailure.unavailable }
        return try self.slhQualificationResources.begin()
      })
    slhResourceDefinition(Function("finishSlhQualificationResources") { (id: String) throws -> [String: Any] in
        guard self.slhForeground() else { self.slhQualificationResources.cancel(id); throw PaliSlhFailure.unavailable }
        return try self.slhQualificationResources.finish(id)
      })
    slhResourceDefinition(Function("cancelSlhQualificationResources") { (id: String) in self.slhQualificationResources.cancel(id) })
    AsyncFunction("publicMerkleBatch") { (program: Data, promise: Promise) in
      PaliPublicMerkleBatch.shared.execute(program, owner: self.publicMerkleOwner) { result in
        switch result {
        case .success(let bytes): promise.resolve(bytes)
        case .failure: promise.reject(PaliCryptoOperationException())
        }
      }
    }
    Class("Key", PaliCryptoKey.self) { Function("destroy") { (key: PaliCryptoKey) in key.destroy() } }
    Class("SlhTree", PaliSlhTree.self) {
      AsyncFunction("release") { (tree: PaliSlhTree, erase: Bool, promise: Promise) in
        // No whole-tree heap copy exists to erase. Drop this owned mapping/FD;
        // published public cache survives, and owned unpublished files are removed.
        tree.release { good in
          if good { promise.resolve() } else { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable") }
        }
      }
    }
    Class("SlhOperation", PaliSlhOperation.self) {
      Function("cancel") { (operation: PaliSlhOperation) in operation.cancel() }
      AsyncFunction("run") { (operation: PaliSlhOperation, promise: Promise) in operation.run(promise) }
    }
    Class("SlhCachePurge", PaliSlhCachePurge.self) {
      Function("cancel") { (operation: PaliSlhCachePurge) in operation.cancel() }
      AsyncFunction("run") { (operation: PaliSlhCachePurge, promise: Promise) in operation.run(promise) }
    }
    Class("SlhContext", PaliSlhContext.self) {
      Function("close") { (context: PaliSlhContext) in context.close() }
      Function("isRetired") { (context: PaliSlhContext) in context.isRetired() }
      AsyncFunction("dispose") { (context: PaliSlhContext, promise: Promise) in context.dispose(promise) }
      Function("importSlhKeyHex") { (context: PaliSlhContext, value: String) in try self.operation { try context.importMaterial(value, seed: false) } }
      Function("importSlhSeedHex") { (context: PaliSlhContext, value: String) in try self.operation { try context.importMaterial(value, seed: true) } }
      Function("allocateTree") { (context: PaliSlhContext) in try self.operation { try context.allocateTree() } }
      Function("loadTree") { (context: PaliSlhContext, id: String) in try self.operation { try context.loadTree(id) } }
      Function("publishTree") { (context: PaliSlhContext, tree: PaliSlhTree, id: String) in try self.operation { try context.publishTree(tree, id: id) } }
      Function("readTreeRoot") { (context: PaliSlhContext, tree: PaliSlhTree) in try self.operation { try context.readRoot(tree) } }
      Function("writeTreeLeaves") { (context: PaliSlhContext, tree: PaliSlhTree, start: Double, value: String) in try self.operation { try context.writeLeaves(tree, start: start, hex: value) } }
      Function("treeChunk") { (context: PaliSlhContext, key: PaliCryptoKey, tree: PaliSlhTree, level: Double, start: Double, count: Double) in try self.operation { try context.treeChunk(key, value: tree, level: level, start: start, count: count) } }
      Function("leafChunk") { (context: PaliSlhContext, key: PaliCryptoKey, start: Double, count: Double) in try self.operation { try context.leafChunk(key, start: start, count: count) } }
      Function("prelude") { (context: PaliSlhContext, key: PaliCryptoKey, message: String, random: String) in try self.operation { try context.prelude(key, message: message, optrand: random) } }
      Function("fors") { (context: PaliSlhContext, key: PaliCryptoKey, prelude: String, index: Double) in try self.operation { try context.fors(key, prelude: prelude, index: index) } }
      Function("finish") { (context: PaliSlhContext, key: PaliCryptoKey, message: String, prelude: String, fors: String, roots: String, tree: PaliSlhTree) in try self.operation { try context.finish(key, message: message, prelude: prelude, fors: fors, roots: roots, value: tree) } }
      Function("cached") { (context: PaliSlhContext, key: PaliCryptoKey, message: String, random: String, tree: PaliSlhTree) in try self.operation { try context.cached(key, message: message, optrand: random, value: tree) } }
      Function("prepareVerify") { (context: PaliSlhContext, key: String, action: String, signature: String) in try self.operation { try context.prepareVerify(key, action: action, signature: signature) } }
    }
    Class("SlhLeafOperation", PaliSlhLeafOperation.self) {
      Function("cancel") { (operation: PaliSlhLeafOperation) in operation.cancel() }
      AsyncFunction("run") { (operation: PaliSlhLeafOperation, promise: Promise) in
        operation.execute { result in
          switch result {
          case .success(let bytes): promise.resolve(bytes)
          case .failure: promise.reject(PaliCryptoOperationException())
          }
        }
      }
    }
    Class("Context", PaliCryptoContext.self) {
      Function("close") { (context: PaliCryptoContext) in context.close() }
      Function("importPublicSlhFixtureSeed") { (context: PaliCryptoContext) in
        try self.operation {
          guard let bundle = Bundle.main.bundleIdentifier, Self.slhQualificationBundles.contains(bundle) else {
            throw PaliCryptoFailure.invalidInput
          }
          return try context.importPublicSlhFixtureSeed()
        }
      }
      Function("prepareSlhLeafChunk") { (context: PaliCryptoContext, key: PaliCryptoKey, start: Double, count: Double) in
        try self.operation { try PaliSlhLeafOperation(context: context, key: key,
          owner: self.slhOwner, start: start, count: count) }
      }
      Function("importKey") { (context: PaliCryptoContext, kind: String, usages: [String], data: Data) in
        try self.operation { try context.importKey(kind, usages, data) }
      }
      Function("randomBytes") { (context: PaliCryptoContext, count: Int) in
        try self.operation { try context.ensureOpen(); return try PaliCryptoPrimitives.random(count) }
      }
      AsyncFunction("signHmacSha512") { (context: PaliCryptoContext, key: PaliCryptoKey, data: Data) in
        try self.operation { try context.usingKey(key, kind: "HMAC-SHA512", usage: "sign") {
          try PaliCryptoPrimitives.signHmacSha512($0, data)
        } }
      }.runOnQueue(queue)
      AsyncFunction("digestSha256") { (context: PaliCryptoContext, data: Data) in
        try self.operation { try context.ensureOpen(); let result = try PaliCryptoPrimitives.digest(data); try context.ensureOpen(); return result }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, iterations: Int, hash: String, length: Int) in
        try self.operation { try context.usingKey(key, kind: "PBKDF2", usage: "deriveBits") {
          try PaliCryptoPrimitives.pbkdf2($0, salt, iterations, hash, length)
        } }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2Key") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, iterations: Int, hash: String, usages: [String]) in
        try self.operation {
          guard hash == "SHA-512" else { throw PaliCryptoFailure.invalidInput }
          var raw = try context.usingKey(key, kind: "PBKDF2", usage: "deriveKey") {
            try PaliCryptoPrimitives.pbkdf2($0, salt, iterations, hash, 32)
          }
          defer { raw.resetBytes(in: raw.startIndex..<raw.endIndex) }
          return try context.importKey("AES-GCM", usages, raw)
        }
      }.runOnQueue(queue)
      AsyncFunction("hkdfBits") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, info: Data, length: Int) in
        try self.operation { try context.usingKey(key, kind: "HKDF", usage: "deriveBits") { try PaliCryptoPrimitives.hkdf($0, salt, info, length) } }
      }.runOnQueue(queue)
      AsyncFunction("hkdfKey") { (context: PaliCryptoContext, key: PaliCryptoKey, salt: Data, info: Data, usages: [String]) in
        try self.operation {
          var raw = try context.usingKey(key, kind: "HKDF", usage: "deriveKey") { try PaliCryptoPrimitives.hkdf($0, salt, info, 32) }
          defer { raw.resetBytes(in: raw.startIndex..<raw.endIndex) }
          return try context.importKey("AES-GCM", usages, raw)
        }
      }.runOnQueue(queue)
      AsyncFunction("encrypt") { (context: PaliCryptoContext, key: PaliCryptoKey, iv: Data, aad: Data, data: Data) in
        try self.operation { try context.usingKey(key, kind: "AES-GCM", usage: "encrypt") { try PaliCryptoPrimitives.encrypt($0, iv, aad, data) } }
      }.runOnQueue(queue)
      AsyncFunction("decrypt") { (context: PaliCryptoContext, key: PaliCryptoKey, iv: Data, aad: Data, data: Data) in
        try self.operation {
          let result = try context.usingKey(key, kind: "AES-GCM", usage: "decrypt") { try PaliCryptoPrimitives.decrypt($0, iv, aad, data) }
          var response = PaliDecryptResponse()
          if case .authenticated(let plaintext) = result { response.status = "authenticated"; response.data = plaintext }
          return response
        }
      }.runOnQueue(queue)
    }
  }
}
