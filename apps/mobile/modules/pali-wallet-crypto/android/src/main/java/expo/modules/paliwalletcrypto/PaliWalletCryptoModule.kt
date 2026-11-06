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
    OnDestroy {
      publicMerkleOwner.retired.set(true)
      slhOwner.retired.set(true)
      queue.cancel()
      dispatcher.close()
    }
    AsyncFunction("publicMerkleBatch") { program: ByteArray, promise: expo.modules.kotlin.Promise ->
      PaliPublicMerkleBatch.execute(program, publicMerkleOwner, promise)
    }
    Class("Key", PaliCryptoKey::class) {
      // Expo requires a constructor declaration even for factory-only handles.
      Constructor { throw CryptoOperationException() }
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
