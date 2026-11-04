package expo.modules.paliwalletcrypto

import org.junit.Assert.*
import org.junit.Test

/** Public synthetic fixtures. JVM primitive checks do not qualify an Android device. */
class PaliCryptoPrimitivesTest {
  private fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }

  @Test fun currentAndLegacyUnicodePasswordBytesAreUnchanged() {
    val password = bytes("5055424c494320666978747572653a20636166c3a9202f2043616665cc81202f20e99baa202f20f09f9490202f200020656e64")
    val salt = ByteArray(32) { it.toByte() }
    assertEquals("dbc234ce231f9c070a9a23a6896a06bb6e39dab4f97f39d397eaea98097c7c26",
      hex(PaliCryptoPrimitives.pbkdf2(password, salt, 20_000, "SHA-512", 32)))
    assertEquals("9862375bd7b5af242b88e330bed94c28385d86579b2f38cea243de90ebaa1056",
      hex(PaliCryptoPrimitives.pbkdf2(password, salt, 900_000, "SHA-512", 32)))
  }

  @Test fun hkdfMatchesRfc5869() {
    val result = PaliCryptoPrimitives.hkdf(ByteArray(22) { 11 }, bytes("000102030405060708090a0b0c"), bytes("f0f1f2f3f4f5f6f7f8f9"), 42)
    assertEquals("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", hex(result))
  }

  @Test fun gcmUsesTypedAuthenticationFailureAndNeverReturnsRejectedPlaintext() {
    val key = ByteArray(32)
    val iv = ByteArray(12)
    val ciphertext = PaliCryptoPrimitives.encrypt(key, iv, byteArrayOf(), byteArrayOf())
    assertEquals("530f8afbc74536b9a963b4f1c4cb738b", hex(ciphertext))
    assertTrue(PaliCryptoPrimitives.decrypt(key, iv, byteArrayOf(), ciphertext) is GcmResult.Authenticated)
    ciphertext[0] = (ciphertext[0].toInt() xor 1).toByte()
    assertSame(GcmResult.AuthenticationRejected, PaliCryptoPrimitives.decrypt(key, iv, byteArrayOf(), ciphertext))
    assertThrows(IllegalArgumentException::class.java) { PaliCryptoPrimitives.decrypt(key, ByteArray(16), byteArrayOf(), ciphertext) }
  }

  @Test fun digestAndEntropyBoundariesAreAvailable() {
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex(PaliCryptoPrimitives.digest("abc".toByteArray())))
    assertEquals(32, PaliCryptoPrimitives.randomBytes(32).size)
    assertThrows(IllegalArgumentException::class.java) { PaliCryptoPrimitives.randomBytes(65_537) }
  }

  @Test fun backupPayloadBoundIsEightMiBWhileDigestKeepsItsSmallerLimit() {
    val plaintext = ByteArray(8 * 1024 * 1024) { 0x37 }
    val key = ByteArray(32)
    val iv = ByteArray(12)
    val aad = ByteArray(64) { 0x21 }
    val encrypted = PaliCryptoPrimitives.encrypt(key, iv, aad, plaintext)
    assertEquals(plaintext.size + 16, encrypted.size)
    val recovered = PaliCryptoPrimitives.decrypt(key, iv, aad, encrypted) as GcmResult.Authenticated
    assertArrayEquals(plaintext, recovered.data)
    assertThrows(IllegalArgumentException::class.java) { PaliCryptoPrimitives.encrypt(key, iv, aad, ByteArray(plaintext.size + 1)) }
    assertThrows(IllegalArgumentException::class.java) { PaliCryptoPrimitives.digest(ByteArray(1024 * 1024 + 1)) }
  }
}
