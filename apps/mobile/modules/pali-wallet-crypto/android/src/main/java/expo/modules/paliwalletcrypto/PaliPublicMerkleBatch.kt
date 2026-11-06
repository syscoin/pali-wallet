package expo.modules.paliwalletcrypto

import expo.modules.kotlin.Promise
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class PaliPublicMerkleBatchOwner {
  val retired = AtomicBoolean(false)
}

private class PaliPublicMerkleNative {
  companion object {
    init { System.loadLibrary("pali_public_mimc") }
    @JvmStatic external fun execute(program: ByteArray): ByteArray?
  }
}

/** One process-wide public arithmetic slot, with no wallet or key context. */
internal object PaliPublicMerkleBatch {
  private const val MAX_OPERATIONS = 296
  private const val HEADER_BYTES = 3
  private const val OPERATION_BYTES = 66
  private val busy = AtomicBoolean(false)
  private val worker = Executors.newSingleThreadExecutor { task ->
    Thread(task, "PaliPublicMerkle").apply { isDaemon = true }
  }

  private fun reject(promise: Promise) {
    promise.reject("ERR_PUBLIC_MERKLE", "Public Merkle batch unavailable", null)
  }

  fun execute(program: ByteArray, owner: PaliPublicMerkleBatchOwner, promise: Promise) {
    if (owner.retired.get() || program.size < HEADER_BYTES ||
        program.size > HEADER_BYTES + MAX_OPERATIONS * OPERATION_BYTES) {
      reject(promise)
      return
    }
    val count = ((program[1].toInt() and 255) shl 8) or (program[2].toInt() and 255)
    if (count !in 1..MAX_OPERATIONS || program.size != HEADER_BYTES + count * OPERATION_BYTES ||
        !busy.compareAndSet(false, true)) {
      reject(promise)
      return
    }
    val owned = try { program.copyOf() } catch (_: Throwable) {
      busy.set(false)
      reject(promise)
      return
    }
    try {
      worker.execute {
        val output = try {
          if (owner.retired.get()) null else PaliPublicMerkleNative.execute(owned)
        } catch (_: Throwable) {
          null
        } finally {
          // Native work has returned before the slot or Promise is released.
          busy.set(false)
        }
        if (output == null || owner.retired.get()) reject(promise)
        else promise.resolve(output)
      }
    } catch (_: Throwable) {
      busy.set(false)
      reject(promise)
    }
  }
}
