package expo.modules.paliwalletcrypto

import expo.modules.kotlin.Promise
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class PaliSlhLeafOperationTest {
  private class Completion : Promise {
    var result: Any? = null
    var error: String? = null

    override fun resolve(value: Any?) { result = value }
    override fun reject(code: String?, message: String?, cause: Throwable?) { error = code }
  }

  @Test fun releaseOfAnyOwnerRetiresAnAlreadyAdmittedResult() {
    val retirements = listOf<(PaliSlhLeafOperation, PaliCryptoContext, PaliCryptoKey, PaliSlhOperationOwner) -> Unit>(
      { operation, _, _, _ -> operation.cancel() },
      { operation, _, _, _ -> operation.sharedObjectDidRelease() },
      { _, context, _, _ -> context.close() },
      { _, _, key, _ -> key.sharedObjectDidRelease() },
      { _, _, _, owner -> owner.retired.set(true) }
    )

    for (retire in retirements) {
      val context = PaliCryptoContext()
      val input = ByteArray(48) { 1 }
      val key = context.registerPublicSlhFixtureSeed(input)
      val owner = PaliSlhOperationOwner()
      val operation = PaliSlhLeafOperation(context, key, owner, 0.0, 1.0)
      val admitted = operation.copySeed()
      input.fill(0)
      retire(operation, context, key, owner)

      // Retirement must not overwrite the worker's independent seed mid-call.
      assertArrayEquals(ByteArray(48) { 1 }, admitted)
      assertThrows(IllegalStateException::class.java) { operation.copySeed() }
      val output = ByteArray(16) { 2 }
      val completion = Completion()
      operation.deliver(output, completion)
      assertEquals("ERR_SLH_SETUP", completion.error)
      assertNull(completion.result)
      assertArrayEquals(ByteArray(16), output)
      admitted.fill(0)
      context.close()
    }
  }

  @Test fun admissionBindsTheContextKeyKindAndRange() {
    val context = PaliCryptoContext()
    val foreign = PaliCryptoContext()
    assertThrows(IllegalArgumentException::class.java) { context.importKey("SLH-DSA-SEED", listOf("derivePublic"), ByteArray(48)) }
    val key = context.registerPublicSlhFixtureSeed(ByteArray(48))
    val otherKind = context.importKey("HMAC-SHA512", listOf("sign"), ByteArray(48))
    val owner = PaliSlhOperationOwner()

    assertThrows(IllegalStateException::class.java) { PaliSlhLeafOperation(foreign, key, owner, 0.0, 1.0) }
    assertThrows(IllegalStateException::class.java) { PaliSlhLeafOperation(context, otherKind, owner, 0.0, 1.0) }
    assertThrows(IllegalArgumentException::class.java) { PaliSlhLeafOperation(context, key, owner, 4_194_304.0, 1.0) }
    assertThrows(IllegalArgumentException::class.java) { PaliSlhLeafOperation(context, key, owner, 0.0, 8_193.0) }
    for (invalid in listOf(1.5, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.MAX_VALUE)) {
      assertThrows(IllegalArgumentException::class.java) { PaliSlhLeafOperation(context, key, owner, invalid, 1.0) }
      assertThrows(IllegalArgumentException::class.java) { PaliSlhLeafOperation(context, key, owner, 0.0, invalid) }
    }
    PaliSlhLeafOperation(context, key, owner, 4_194_303.0, 1.0)
    context.close()
    foreign.close()
  }
}
