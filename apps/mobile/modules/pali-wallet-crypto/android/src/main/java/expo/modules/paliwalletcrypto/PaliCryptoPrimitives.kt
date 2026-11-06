package expo.modules.paliwalletcrypto

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.digests.SHA512Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.KeyParameter

internal sealed class GcmResult {
  data class Authenticated(val data: ByteArray) : GcmResult()
  data object AuthenticationRejected : GcmResult()
}

/** Uses platform AES/entropy/digest and pinned, mature byte-oriented KDFs. */
internal object PaliCryptoPrimitives {
  const val MAX_GCM_DATA = 8 * 1024 * 1024
  const val MAX_DIGEST_DATA = 1_048_576
  const val MAX_PARAMETER = 65_536
  private val random = SecureRandom()

  fun randomBytes(count: Int): ByteArray {
    require(count in 0..65_536)
    return ByteArray(count).also { random.nextBytes(it) }
  }

  fun digest(data: ByteArray): ByteArray {
    require(data.size <= MAX_DIGEST_DATA)
    return MessageDigest.getInstance("SHA-256").digest(data)
  }

  fun signHmacSha512(key: ByteArray, data: ByteArray): ByteArray {
    require(key.isNotEmpty() && key.size <= 4_096 && data.size <= MAX_DIGEST_DATA)
    return Mac.getInstance("HmacSHA512").run {
      init(SecretKeySpec(key, "HmacSHA512"))
      doFinal(data)
    }
  }

  fun pbkdf2(password: ByteArray, salt: ByteArray, iterations: Int, hash: String, length: Int): ByteArray {
    require(password.size <= 4_096 && salt.size <= MAX_PARAMETER)
    require(iterations in 1..2_000_000 && length in 1..64)
    val digest = when (hash) {
      "SHA-256" -> SHA256Digest()
      "SHA-512" -> SHA512Digest()
      else -> throw IllegalArgumentException("Unsupported digest")
    }
    val generator = PKCS5S2ParametersGenerator(digest)
    generator.init(password, salt, iterations)
    return (generator.generateDerivedParameters(length * 8) as KeyParameter).key.copyOf()
  }

  fun hkdf(input: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    require(input.isNotEmpty() && input.size <= 4_096)
    require(salt.size <= MAX_PARAMETER && info.size <= MAX_PARAMETER && length in 1..64)
    val generator = HKDFBytesGenerator(SHA256Digest())
    generator.init(HKDFParameters(input, salt, info))
    return ByteArray(length).also { generator.generateBytes(it, 0, it.size) }
  }

  private fun cipher(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, size: Int): Cipher {
    require(key.size == 32 && iv.size == 12 && aad.size <= MAX_PARAMETER)
    require(size >= (if (mode == Cipher.DECRYPT_MODE) 16 else 0))
    require(size <= MAX_GCM_DATA + (if (mode == Cipher.DECRYPT_MODE) 16 else 0))
    return Cipher.getInstance("AES/GCM/NoPadding").apply {
      init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
      updateAAD(aad)
    }
  }

  fun encrypt(key: ByteArray, iv: ByteArray, aad: ByteArray, plaintext: ByteArray): ByteArray =
    cipher(Cipher.ENCRYPT_MODE, key, iv, aad, plaintext.size).doFinal(plaintext)

  fun decrypt(key: ByteArray, iv: ByteArray, aad: ByteArray, ciphertext: ByteArray): GcmResult {
    // Argument/provider setup failures cannot be mistaken for bad authentication.
    val cipher = cipher(Cipher.DECRYPT_MODE, key, iv, aad, ciphertext.size)
    return try {
      GcmResult.Authenticated(cipher.doFinal(ciphertext))
    } catch (_: AEADBadTagException) {
      GcmResult.AuthenticationRejected
    }
  }
}
