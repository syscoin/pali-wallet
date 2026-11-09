package expo.modules.paliwalletcrypto

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.sharedobjects.SharedObject
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel

private class CryptoOperationException : CodedException("Native cryptographic operation failed")

class PaliCryptoKey internal constructor(
  private val owner: PaliCryptoContext,
  private val kind: String,
  private val usages: Set<String>,
  bytes: ByteArray
) : SharedObject() {
  private var material: ByteArray? = bytes.copyOf()

  @Synchronized internal fun copyMaterial(context: PaliCryptoContext, kind: String, usage: String): ByteArray {
    require(owner === context && this.kind == kind && usages.contains(usage))
    context.ensureOpen()
    return checkNotNull(material).copyOf()
  }

  @Synchronized internal fun isUsable(context: PaliCryptoContext, kind: String, usage: String): Boolean =
    owner === context && this.kind == kind && usages.contains(usage) && material != null

  @Synchronized internal fun destroy() { material?.fill(0); material = null }
  override fun sharedObjectDidRelease() { destroy() }
  @Synchronized override fun getAdditionalMemoryPressure(): Int = material?.size ?: 0
}

class PaliCryptoContext : SharedObject() {
  private var closed = false
  private val keys = mutableListOf<WeakReference<PaliCryptoKey>>()

  @Synchronized internal fun ensureOpen() { check(!closed) }

  @Synchronized internal fun importKey(kind: String, usages: List<String>, data: ByteArray): PaliCryptoKey {
    ensureOpen()
    val allowed = when (kind) {
      "AES-GCM" -> setOf("encrypt", "decrypt")
      "HMAC-SHA512" -> setOf("sign")
      else -> setOf("deriveBits", "deriveKey")
    }
    require(kind in setOf("AES-GCM", "PBKDF2", "HKDF", "HMAC-SHA512"))
    require(usages.isNotEmpty() && usages.size <= 2 && usages.toSet().size == usages.size && allowed.containsAll(usages))
    require(data.size <= 4_096 && (kind != "AES-GCM" || data.size == 32) &&
      (kind !in setOf("HKDF", "HMAC-SHA512") || data.isNotEmpty()))
    return registerKey(kind, usages.toSet(), data)
  }

  @Synchronized internal fun registerPublicSlhFixtureSeed(data: ByteArray): PaliCryptoKey {
    ensureOpen()
    require(data.size == 48)
    return registerKey("SLH-DSA-SEED", setOf("derivePublic"), data)
  }
  @Synchronized internal fun registerSlhMaterial(data: ByteArray, seed: Boolean): PaliCryptoKey {
    ensureOpen(); require(data.size == (if (seed) 48 else 64))
    return registerKey(if (seed) "SLH-DSA-SEED" else "SLH-DSA-SK", setOf(if (seed) "derivePublic" else "sign"), data)
  }

  private fun registerKey(kind: String, usages: Set<String>, data: ByteArray): PaliCryptoKey {
    keys.removeAll { it.get() == null }
    return PaliCryptoKey(this, kind, usages, data).also { keys.add(WeakReference(it)) }
  }

  internal fun <T> usingKey(key: PaliCryptoKey, kind: String, usage: String, body: (ByteArray) -> T): T {
    val material = key.copyMaterial(this, kind, usage)
    return try { body(material).also { ensureOpen() } } finally { material.fill(0) }
  }

  internal fun close() {
    val live = synchronized(this) {
      closed = true
      keys.mapNotNull { it.get() }.also { keys.clear() }
    }
    live.forEach { it.destroy() }
  }

  override fun sharedObjectDidRelease() { close() }
}

class PaliDecryptResponse : Record {
  @Field var status: String = "authentication-rejected"
  @Field var data: ByteArray? = null
}

class PaliWalletCryptoModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor { task ->
    Thread(task, "PaliWalletCrypto").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  private val queue = CoroutineScope(SupervisorJob() + dispatcher)
  private val publicMerkleOwner = PaliPublicMerkleBatchOwner()
  private val slhOwner = PaliSlhOperationOwner()

  private inline fun <T> operation(body: () -> T): T =
    try { body() } catch (_: Exception) { throw CryptoOperationException() }

  override fun definition() = ModuleDefinition {
    Name("PaliWalletCrypto")
    Function("info") { mapOf("apiVersion" to 1, "implementation" to "android-jca-bc") }
    Function("createContext") { PaliCryptoContext() }
    Function("createSlhContext") { namespace: String -> operation {
      check(appContext.reactContext?.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED)
      PaliSlhContext(checkNotNull(appContext.reactContext), namespace, slhOwner)
    } }
    Function("prepareSlhCachePurge") { namespace: String -> operation {
      check(appContext.reactContext?.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED)
      PaliSlhCachePurge(checkNotNull(appContext.reactContext), namespace, slhOwner)
    } }
    OnActivityEntersBackground { slhOwner.background() }
    OnActivityEntersForeground { slhOwner.resume() }
    OnDestroy {
      publicMerkleOwner.retired.set(true)
      slhOwner.retire()
      queue.cancel()
      dispatcher.close()
    }
    AsyncFunction("publicMerkleBatch") { program: ByteArray, promise: expo.modules.kotlin.Promise ->
      PaliPublicMerkleBatch.execute(program, publicMerkleOwner, promise)
    }
    Class("Key", PaliCryptoKey::class) {
      // Expo requires a constructor declaration even for factory-only handles.
      Constructor { throw CryptoOperationException() }
      Function("destroy") { key: PaliCryptoKey -> key.destroy() }
    }
    Class("SlhTree", PaliSlhTree::class) {
      Constructor { throw CryptoOperationException() }
      AsyncFunction("release") { tree: PaliSlhTree, erase: Boolean, promise: expo.modules.kotlin.Promise -> tree.release(promise) }
    }
    Class("SlhOperation", PaliSlhOperation::class) {
      Constructor { throw CryptoOperationException() }
      Function("cancel") { operation: PaliSlhOperation -> operation.cancel() }
      AsyncFunction("run") { operation: PaliSlhOperation, promise: expo.modules.kotlin.Promise -> operation.run(promise) }
    }
    Class("SlhCachePurge", PaliSlhCachePurge::class) {
      Constructor { throw CryptoOperationException() }
      Function("cancel") { operation: PaliSlhCachePurge -> operation.cancel() }
      AsyncFunction("run") { operation: PaliSlhCachePurge, promise: expo.modules.kotlin.Promise -> operation.run(promise) }
    }
    Class("SlhContext", PaliSlhContext::class) {
      Constructor { throw CryptoOperationException() }
      Function("close") { context: PaliSlhContext -> context.close() }
      Function("isRetired") { context: PaliSlhContext -> context.isRetired() }
      AsyncFunction("dispose") { context: PaliSlhContext, promise: expo.modules.kotlin.Promise -> context.dispose(promise) }
      Function("importSlhKeyHex") { context: PaliSlhContext, value: String -> operation { context.importMaterial(value, false) } }
      Function("importSlhSeedHex") { context: PaliSlhContext, value: String -> operation { context.importMaterial(value, true) } }
      Function("allocateTree") { context: PaliSlhContext -> operation { context.allocateTree() } }
      Function("loadTree") { context: PaliSlhContext, id: String -> operation { context.loadTree(id) } }
      Function("publishTree") { context: PaliSlhContext, tree: PaliSlhTree, id: String -> operation { context.publishTree(tree, id) } }
      Function("readTreeRoot") { context: PaliSlhContext, tree: PaliSlhTree -> operation { context.readTreeRoot(tree) } }
      Function("writeTreeLeaves") { context: PaliSlhContext, tree: PaliSlhTree, start: Double, value: String -> operation { context.writeTreeLeaves(tree, start, value) } }
      Function("treeChunk") { context: PaliSlhContext, key: PaliCryptoKey, tree: PaliSlhTree, level: Double, start: Double, count: Double -> operation { context.treeChunk(key, tree, level, start, count) } }
      Function("leafChunk") { context: PaliSlhContext, key: PaliCryptoKey, start: Double, count: Double -> operation { context.leafChunk(key, start, count) } }
      Function("prelude") { context: PaliSlhContext, key: PaliCryptoKey, message: String, random: String -> operation { context.prelude(key, message, random) } }
      Function("fors") { context: PaliSlhContext, key: PaliCryptoKey, prefix: String, index: Double -> operation { context.fors(key, prefix, index) } }
      Function("finish") { context: PaliSlhContext, key: PaliCryptoKey, message: String, prefix: String, fors: String, roots: String, tree: PaliSlhTree -> operation { context.finish(key, message, prefix, fors, roots, tree) } }
      Function("cached") { context: PaliSlhContext, key: PaliCryptoKey, message: String, random: String, tree: PaliSlhTree -> operation { context.cached(key, message, random, tree) } }
      Function("prepareVerify") { context: PaliSlhContext, key: String, action: String, signature: String -> operation { context.prepareVerify(key, action, signature) } }
    }
    Class("SlhLeafOperation", PaliSlhLeafOperation::class) {
      Constructor { throw CryptoOperationException() }
      Function("cancel") { operation: PaliSlhLeafOperation -> operation.cancel() }
      AsyncFunction("run") { operation: PaliSlhLeafOperation, promise: expo.modules.kotlin.Promise ->
        operation.execute(promise)
      }
    }
    Class("Context", PaliCryptoContext::class) {
      Constructor { throw CryptoOperationException() }
      Function("close") { context: PaliCryptoContext -> context.close() }
      Function("importPublicSlhFixtureSeed") { context: PaliCryptoContext ->
        operation {
          check(appContext.reactContext?.packageName == "com.paliwallet.qualification")
          val seed = checkNotNull(PaliSlhNative.publicFixtureSeed())
          try { context.registerPublicSlhFixtureSeed(seed) } finally { seed.fill(0) }
        }
      }
      Function("prepareSlhLeafChunk") { context: PaliCryptoContext, key: PaliCryptoKey, start: Double, count: Double ->
        operation { PaliSlhLeafOperation(context, key, slhOwner, start, count) }
      }
      Function("importKey") { context: PaliCryptoContext, kind: String, usages: List<String>, bytes: ByteArray ->
        operation { context.importKey(kind, usages, bytes) }
      }
      Function("randomBytes") { context: PaliCryptoContext, count: Int ->
        operation { context.ensureOpen(); PaliCryptoPrimitives.randomBytes(count) }
      }
      AsyncFunction("signHmacSha512") { context: PaliCryptoContext, key: PaliCryptoKey, data: ByteArray ->
        operation { context.usingKey(key, "HMAC-SHA512", "sign") { PaliCryptoPrimitives.signHmacSha512(it, data) } }
      }.runOnQueue(queue)
      AsyncFunction("digestSha256") { context: PaliCryptoContext, data: ByteArray ->
        operation { context.ensureOpen(); PaliCryptoPrimitives.digest(data).also { context.ensureOpen() } }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2") { context: PaliCryptoContext, key: PaliCryptoKey, salt: ByteArray, iterations: Int, hash: String, length: Int ->
        operation { context.usingKey(key, "PBKDF2", "deriveBits") { PaliCryptoPrimitives.pbkdf2(it, salt, iterations, hash, length) } }
      }.runOnQueue(queue)
      AsyncFunction("pbkdf2Key") { context: PaliCryptoContext, key: PaliCryptoKey, salt: ByteArray, iterations: Int, hash: String, usages: List<String> ->
        operation {
          require(hash == "SHA-512")
          val raw = context.usingKey(key, "PBKDF2", "deriveKey") { PaliCryptoPrimitives.pbkdf2(it, salt, iterations, hash, 32) }
          try { context.importKey("AES-GCM", usages, raw) } finally { raw.fill(0) }
        }
      }.runOnQueue(queue)
      AsyncFunction("hkdfBits") { context: PaliCryptoContext, key: PaliCryptoKey, salt: ByteArray, info: ByteArray, length: Int ->
        operation { context.usingKey(key, "HKDF", "deriveBits") { PaliCryptoPrimitives.hkdf(it, salt, info, length) } }
      }.runOnQueue(queue)
      AsyncFunction("hkdfKey") { context: PaliCryptoContext, key: PaliCryptoKey, salt: ByteArray, info: ByteArray, usages: List<String> ->
        operation {
          val raw = context.usingKey(key, "HKDF", "deriveKey") { PaliCryptoPrimitives.hkdf(it, salt, info, 32) }
          try { context.importKey("AES-GCM", usages, raw) } finally { raw.fill(0) }
        }
      }.runOnQueue(queue)
      AsyncFunction("encrypt") { context: PaliCryptoContext, key: PaliCryptoKey, iv: ByteArray, aad: ByteArray, data: ByteArray ->
        operation { context.usingKey(key, "AES-GCM", "encrypt") { PaliCryptoPrimitives.encrypt(it, iv, aad, data) } }
      }.runOnQueue(queue)
      AsyncFunction("decrypt") { context: PaliCryptoContext, key: PaliCryptoKey, iv: ByteArray, aad: ByteArray, data: ByteArray ->
        operation {
          val result = context.usingKey(key, "AES-GCM", "decrypt") { PaliCryptoPrimitives.decrypt(it, iv, aad, data) }
          PaliDecryptResponse().apply {
            if (result is GcmResult.Authenticated) { status = "authenticated"; this.data = result.data }
          }
        }
      }.runOnQueue(queue)
    }
  }
}
