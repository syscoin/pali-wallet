package expo.modules.paliwalletcrypto

import expo.modules.kotlin.Promise
import expo.modules.kotlin.sharedobjects.SharedObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val KEY_KIND = "SLH-DSA-SEED"
private const val KEY_USAGE = "derivePublic"

internal class PaliSlhOperationOwner {
  val retired = AtomicBoolean(false)
  val foreground = AtomicBoolean(true)
  private val retirements = mutableListOf<() -> Unit>()
  private val namespaces = mutableMapOf<String, Int>()
  private val purging = mutableSetOf<String>()
  private val poisoned = mutableSetOf<String>()
  @Synchronized fun openNamespace(namespace: String): Boolean {
    if (!isOpen || namespace in purging || namespace in poisoned) return false
    namespaces[namespace] = (namespaces[namespace] ?: 0) + 1; return true
  }
  @Synchronized fun closeNamespace(namespace: String, clean: Boolean) {
    if (clean) namespaces[namespace] = (namespaces[namespace] ?: 0) - 1 else poisoned.add(namespace)
  }
  @Synchronized fun beginPurge(namespace: String): Boolean {
    if (!isOpen || (namespaces[namespace] ?: 0) != 0 || namespace in purging || namespace in poisoned) return false
    purging.add(namespace); return true
  }
  @Synchronized fun endPurge(namespace: String, clean: Boolean) { if (clean) purging.remove(namespace) else poisoned.add(namespace) }
  fun onRetire(callback: () -> Unit) {
    val immediate = synchronized(this) { if (!isOpen) true else { retirements.add(callback); false } }
    if (immediate) callback()
  }
  fun retire() {
    val callbacks = synchronized(this) { retired.set(true); retirements.toList().also { retirements.clear() } }
    callbacks.forEach { it() }
  }
  fun background() { val callbacks = synchronized(this) { foreground.set(false); retirements.toList() }; callbacks.forEach { it() } }
  fun resume() { foreground.set(true) }
  val isOpen: Boolean get() = !retired.get() && foreground.get()
}

internal class PaliSlhNative {
  companion object {
    init { System.loadLibrary("pali_slh_engine") }
    @JvmStatic external fun publicFixtureSeed(): ByteArray?
    @JvmStatic external fun leafChunk(seed: ByteArray, start: Int, count: Int): ByteArray?
    @JvmStatic external fun openNamespace(base: String, namespace: String, create: Boolean): Int
    @JvmStatic external fun openTree(directory: Int, name: String, create: Boolean): Int
    @JvmStatic external fun reserveTree(fd: Int): Boolean
    @JvmStatic external fun validateTree(directory: Int, fd: Int, name: String): Boolean
    @JvmStatic external fun closeDescriptor(fd: Int): Boolean
    @JvmStatic external fun abortTree(directory: Int, fd: Int, name: String): Boolean
    @JvmStatic external fun publishTree(directory: Int, fd: Int, from: String, to: String, tree: PaliSlhTree): Int
    @JvmStatic external fun purgeTrees(directory: Int, operation: PaliSlhCachePurge): Int
    @JvmStatic external fun readTreeRoot(fd: Int): ByteArray?
    @JvmStatic external fun writeTreeLeaves(fd: Int, start: Int, bytes: ByteArray): Boolean
    @JvmStatic external fun treeChunk(seed: ByteArray, fd: Int, level: Int, start: Int, count: Int, tree: PaliSlhTree): Int
    @JvmStatic external fun prelude(key: ByteArray, action: ByteArray, optrand: ByteArray): ByteArray?
    @JvmStatic external fun fors(key: ByteArray, prelude: ByteArray, index: Int): ByteArray?
    @JvmStatic external fun cached(key: ByteArray, action: ByteArray, optrand: ByteArray, fd: Int, tree: PaliSlhTree): ByteArray?
    @JvmStatic external fun finish(key: ByteArray, action: ByteArray, prelude: ByteArray, fors: ByteArray, roots: ByteArray, fd: Int, tree: PaliSlhTree): ByteArray?
    @JvmStatic external fun verify(key: ByteArray, action: ByteArray, signature: ByteArray): Int
  }
}

/** A setup-only operation. Its result contains public WOTS leaves. */
class PaliSlhLeafOperation internal constructor(
  private val context: PaliCryptoContext,
  private val key: PaliCryptoKey,
  private val owner: PaliSlhOperationOwner,
  start: Double,
  count: Double
) : SharedObject() {
  private val start: Int
  private val count: Int
  private val started = AtomicBoolean(false)
  private val retired = AtomicBoolean(false)

  init {
    require(count in 1.0..8_192.0 && start in 0.0..(4_194_304.0 - count) &&
      start % 1.0 == 0.0 && count % 1.0 == 0.0)
    this.start = start.toInt()
    this.count = count.toInt()
    check(isCurrent())
    val weak = java.lang.ref.WeakReference(this); owner.onRetire { weak.get()?.cancel() }
  }

  internal fun cancel() { retired.set(true) }
  override fun sharedObjectDidRelease() { cancel() }

  private fun isCurrent(): Boolean =
    !retired.get() && owner.isOpen && runCatching { context.ensureOpen() }.isSuccess &&
      key.isUsable(context, KEY_KIND, KEY_USAGE)

  internal fun execute(promise: Promise) {
    if (!started.compareAndSet(false, true) || !isCurrent()) { reject(promise); return }
    PaliSlhLeafWorker.execute(this, promise)
  }

  internal fun copySeed(): ByteArray {
    check(isCurrent())
    return key.copyMaterial(context, KEY_KIND, KEY_USAGE)
  }

  internal fun run(seed: ByteArray): ByteArray? =
    if (isCurrent()) PaliSlhNative.leafChunk(seed, start, count) else null

  internal fun deliver(output: ByteArray?, promise: Promise) {
    if (output == null || !isCurrent()) {
      output?.fill(0)
      reject(promise)
    } else promise.resolve(output)
  }

  private fun reject(promise: Promise) {
    promise.reject("ERR_SLH_SETUP", "Native SLH setup operation unavailable", null)
  }
}

internal object PaliSlhLeafWorker {
  private val busy = AtomicBoolean(false)
  private val queue = Executors.newSingleThreadExecutor { task ->
    Thread(task, "PaliSlhSetup").apply { isDaemon = true }
  }
  fun cleanup(work: () -> Unit) { queue.execute(work) }

  fun <T> enqueue(work: () -> T, complete: (T) -> Unit): Boolean {
    if (!busy.compareAndSet(false, true)) return false
    return try {
      queue.execute {
        val result = try { work() } finally { busy.set(false) }
        complete(result)
      }
      true
    } catch (_: Throwable) { busy.set(false); false }
  }

  fun execute(operation: PaliSlhLeafOperation, promise: Promise) {
    val seed = try { operation.copySeed() } catch (_: Throwable) {
      operation.deliver(null, promise)
      return
    }
    val admitted = enqueue({
      try { operation.run(seed) } catch (_: Throwable) { null }
      finally { seed.fill(0) }
    }, { output -> operation.deliver(output, promise) })
    if (!admitted) {
      seed.fill(0)
      operation.deliver(null, promise)
    }
  }
}
