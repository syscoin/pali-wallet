package expo.modules.paliwalletcrypto

import expo.modules.kotlin.Promise
import expo.modules.kotlin.sharedobjects.SharedObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val KEY_KIND = "SLH-DSA-SEED"
private const val KEY_USAGE = "derivePublic"

internal class PaliSlhOperationOwner {
  val retired = AtomicBoolean(false)
}

internal class PaliSlhNative {
  companion object {
    init { System.loadLibrary("pali_slh_engine") }
    @JvmStatic external fun publicFixtureSeed(): ByteArray?
    @JvmStatic external fun leafChunk(seed: ByteArray, start: Int, count: Int): ByteArray?
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
  }

  internal fun cancel() { retired.set(true) }
  override fun sharedObjectDidRelease() { cancel() }

  private fun isCurrent(): Boolean =
    !retired.get() && !owner.retired.get() && runCatching { context.ensureOpen() }.isSuccess &&
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

private object PaliSlhLeafWorker {
  private val busy = AtomicBoolean(false)
  private val queue = Executors.newSingleThreadExecutor { task ->
    Thread(task, "PaliSlhSetup").apply { isDaemon = true }
  }

  fun execute(operation: PaliSlhLeafOperation, promise: Promise) {
    if (!busy.compareAndSet(false, true)) { operation.deliver(null, promise); return }
    val seed = try { operation.copySeed() } catch (_: Throwable) {
      busy.set(false)
      operation.deliver(null, promise)
      return
    }
    try {
      queue.execute {
        val output = try { operation.run(seed) } catch (_: Throwable) { null }
        finally {
          // Keep the live C input owned until it returns, even after cancellation.
          seed.fill(0)
          busy.set(false)
        }
        operation.deliver(output, promise)
      }
    } catch (_: Throwable) {
      seed.fill(0)
      busy.set(false)
      operation.deliver(null, promise)
    }
  }
}
