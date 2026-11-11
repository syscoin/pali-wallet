package org.syscoin.pali.storage

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.Promise
import expo.modules.kotlin.sharedobjects.SharedObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

internal class PaliCredentialFailure(val code: String) : Exception("Device authorization unavailable")
internal class PaliCredentialBinding(val value: String) {
  val id: String
  init {
    require(value.length < 256 && Regex("^\\[1,\"[0-9a-f]{32}\",\"[0-9a-f]{64}\",\"[0-9a-f]{64}\",\"[0-9a-f]{32}\"\\]$").matches(value))
    id = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.US_ASCII)).joinToString("") { "%02x".format(it) }
  }
  val alias get() = "org.pali.mobile.protected-vault.v1.$id"
}
private fun credentialFailure(code: String = "CREDENTIAL_UNAVAILABLE"): Nothing = throw PaliCredentialFailure(code)
private val credentialExecutor = Executors.newSingleThreadExecutor { task -> Thread(task, "PaliCredential").apply { isDaemon = true } }
private val credentialMain = Handler(Looper.getMainLooper())
private fun secretValid(bytes: ByteArray): Boolean {
  val prefix = "Pali#1:".toByteArray(Charsets.US_ASCII)
  return bytes.size == 71 && bytes.take(7).toByteArray().contentEquals(prefix) &&
    bytes.drop(7).all { it in 48..57 || it in 97..102 }
}

internal class PaliCredentialOwner(private val app: Context, private val activity: () -> Activity?) {
  private var closed = false
  private var active: PaliCredentialRequest? = null
  @Synchronized fun admit(request: PaliCredentialRequest): Boolean {
    if (closed || active != null) return false
    active = request; return true
  }
  @Synchronized fun current(request: PaliCredentialRequest) = !closed && active === request
  @Synchronized fun finish(request: PaliCredentialRequest): Boolean? {
    val permitted = request.claimCompletion() ?: return null
    val valid = !closed && active === request && permitted
    if (active === request) active = null
    return valid
  }
  @Synchronized fun isAuthenticating() = !closed && active?.isAuthenticating() == true
  fun background() { if (!isAuthenticating()) cancel() }
  fun cancel(binding: String? = null) {
    val request = synchronized(this) { active }
    if (binding == null || request?.binding?.value == binding) request?.cancel()
  }
  fun close() { val request = synchronized(this) { closed = true; active }; request?.cancel() }
  fun foreground(expected: Activity? = null): Boolean {
    fun inspect(): Boolean = activity()?.let { (expected == null || it === expected) && !it.isFinishing && !it.isDestroyed && it.hasWindowFocus() } == true
    if (Looper.myLooper() == Looper.getMainLooper()) return inspect()
    val done = CountDownLatch(1); var result = false
    credentialMain.post { result = inspect(); done.countDown() }
    return done.await(2, TimeUnit.SECONDS) && result
  }
  fun host(): Activity = activity() ?: credentialFailure("CREDENTIAL_CANCELLED")
  fun capabilities(raw: String?): Map<String, Any> {
    var state = if (Build.VERSION.SDK_INT < 30) "unsupported" else if (app.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true) "ready" else "missing"
    val present = if (state == "unsupported") false else raw?.let { store().present(PaliCredentialBinding(it)) } ?: false
    if (present && raw != null) {
      try { store().existingKey(PaliCredentialBinding(raw)) }
      catch (error: PaliCredentialFailure) { if (error.code == "CREDENTIAL_UNSUPPORTED") state = "unsupported" else throw error }
    }
    return mapOf("deviceAuth" to state, "credentialPresent" to present)
  }
  fun store() = PaliCredentialStore(app)
  fun remove(raw: String) {
    val binding = PaliCredentialBinding(raw); cancel(raw); store().remove(binding)
  }
}

internal class PaliCredentialStore(private val app: Context) {
  private fun directory(): File {
    val directory = File(app.noBackupFilesDir, "PaliCredentials")
    if (!directory.exists() && !directory.mkdir()) credentialFailure()
    val stat = Os.lstat(directory.path)
    if (!OsConstants.S_ISDIR(stat.st_mode) || stat.st_uid != android.os.Process.myUid()) credentialFailure()
    return directory
  }
  private fun file(binding: PaliCredentialBinding) = File(directory(), "${binding.id}.bin")
  fun present(binding: PaliCredentialBinding): Boolean {
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!keys.containsAlias(binding.alias)) return false
    val stat = try { Os.lstat(file(binding).path) } catch (error: ErrnoException) { if (error.errno == OsConstants.ENOENT) return false else throw error }
    return OsConstants.S_ISREG(stat.st_mode) && stat.st_uid == android.os.Process.myUid() && stat.st_size == 102L
  }
  fun read(binding: PaliCredentialBinding): ByteArray? {
    val file = file(binding)
    val descriptor = try { Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0) }
      catch (error: ErrnoException) { if (error.errno == OsConstants.ENOENT) return null else throw error }
    return FileInputStream(descriptor).use { input ->
      val stat = Os.fstat(descriptor)
      if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_uid != android.os.Process.myUid() || stat.st_size != 102L) credentialFailure()
      val bytes = ByteArray(102)
      var offset = 0
      while (offset < bytes.size) { val count = input.read(bytes, offset, bytes.size - offset); if (count <= 0) credentialFailure(); offset += count }
      if (input.read() != -1) credentialFailure()
      if (bytes.size != 102 || bytes[0] != 80.toByte() || bytes[1] != 67.toByte() || bytes[2] != 1.toByte()) credentialFailure()
      bytes
    }
  }
  fun write(binding: PaliCredentialBinding, bytes: ByteArray) {
    check(bytes.size == 102)
    val final = file(binding); val temporary = File(directory(), "${binding.id}.new")
    val descriptor = Os.open(temporary.path, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_NOFOLLOW, 384)
    try {
      FileOutputStream(descriptor).use { output -> output.write(bytes); output.flush(); Os.fsync(descriptor) }
      Os.link(temporary.path, final.path)
      Os.remove(temporary.path)
      syncDirectory()
      val readback = read(binding) ?: credentialFailure()
      try { if (!MessageDigest.isEqual(bytes, readback)) credentialFailure() } finally { readback.fill(0) }
    } finally { try { Os.remove(temporary.path) } catch (error: ErrnoException) { if (error.errno != OsConstants.ENOENT) throw error } }
  }
  private fun syncDirectory() {
    val descriptor = Os.open(directory().path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
    try { if (!OsConstants.S_ISDIR(Os.fstat(descriptor).st_mode)) credentialFailure(); Os.fsync(descriptor) } finally { Os.close(descriptor) }
  }
  fun remove(binding: PaliCredentialBinding) {
    for (suffix in listOf("bin", "new")) {
      try { Os.remove(File(directory(), "${binding.id}.$suffix").path) }
      catch (error: ErrnoException) { if (error.errno != OsConstants.ENOENT) throw error }
    }
    syncDirectory()
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    keys.deleteEntry(binding.alias)
  }
  fun existingKey(binding: PaliCredentialBinding): SecretKey {
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val key = keys.getKey(binding.alias, null) as? SecretKey ?: credentialFailure("CREDENTIAL_MISSING")
    val info = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java) as KeyInfo
    if (Build.VERSION.SDK_INT < 30 || !info.isUserAuthenticationRequired || info.userAuthenticationValidityDurationSeconds > 0 ||
        info.userAuthenticationType != (KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL) ||
        info.keySize != 256 || info.blockModes.toSet() != setOf(KeyProperties.BLOCK_MODE_GCM) ||
        info.encryptionPaddings.toSet() != setOf(KeyProperties.ENCRYPTION_PADDING_NONE)) credentialFailure()
    val protectedByHardware = if (Build.VERSION.SDK_INT >= 31) info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT || info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX else info.isInsideSecureHardware
    if (!protectedByHardware || !info.isUserAuthenticationRequirementEnforcedBySecureHardware) credentialFailure("CREDENTIAL_UNSUPPORTED")
    return key
  }
  fun createKey(binding: PaliCredentialBinding): SecretKey {
    if (Build.VERSION.SDK_INT < 30) credentialFailure()
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (keys.containsAlias(binding.alias) || read(binding) != null) credentialFailure()
    val spec = KeyGenParameterSpec.Builder(binding.alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setUserAuthenticationRequired(true).setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
      .setUnlockedDeviceRequired(true).build()
    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run { init(spec); generateKey() }
    try { return existingKey(binding) }
    catch (error: Exception) { keys.deleteEntry(binding.alias); throw error }
  }
}

class PaliCredentialRequest internal constructor(private val owner: PaliCredentialOwner, raw: String, secret: String? = null, private val authorizationOnly: Boolean = false) : SharedObject() {
  internal val binding = PaliCredentialBinding(raw)
  private val started = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  private val completed = AtomicBoolean(false)
  private val authenticationHandled = AtomicBoolean(false)
  private val cancellation = CancellationSignal()
  @Volatile private var authenticating = false
  private var staged = secret?.toByteArray(Charsets.US_ASCII)
  private var host: Activity? = null
  @Volatile private var createdAlias = false
  init { require(staged == null || secretValid(staged!!)) }
  @Synchronized internal fun claimCompletion(): Boolean? {
    if (completed.get()) return null
    completed.set(true); authenticating = false
    return !cancelled.get()
  }
  internal fun isAuthenticating() = authenticating && !cancelled.get() && !completed.get()
  internal fun cancel() {
    synchronized(this) {
      if (completed.get()) return
      cancelled.set(true); authenticating = false
      if (!started.get()) { staged?.fill(0); staged = null }
    }
    cancellation.cancel()
  }
  private fun check(requireForeground: Boolean = true) {
    if (cancelled.get() || completed.get() || !owner.current(this) || (requireForeground && !owner.foreground(host))) credentialFailure("CREDENTIAL_CANCELLED")
  }
  /** The authenticated cipher contains no plaintext. Wait for the original Activity before doFinal. */
  private fun whenForeground(promise: Promise, cleanup: Boolean, ciphertext: ByteArray?, work: () -> Unit) {
    val deadline = android.os.SystemClock.elapsedRealtime() + 3_000
    val resume = object : Runnable {
      override fun run() {
        try {
          check(false)
          if (owner.foreground(host)) {
            authenticating = false
            credentialExecutor.execute(work)
          } else {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) credentialFailure("CREDENTIAL_CANCELLED")
            credentialMain.postDelayed(this, 25)
          }
        } catch (error: Exception) { finish(promise, null, error, cleanup, ciphertext) }
      }
    }
    credentialMain.post(resume)
  }
  internal fun run(promise: Promise) {
    val first = started.compareAndSet(false, true)
    if (!first || cancelled.get() || owner.capabilities(null)["deviceAuth"] != "ready" || !owner.foreground() || !owner.admit(this)) {
      if (first) { staged?.fill(0); staged = null }
      reject(promise, PaliCredentialFailure("CREDENTIAL_CANCELLED")); return
    }
    try { host = owner.host() } catch (error: Exception) { finish(promise, null, error, false, null); return }
    credentialExecutor.execute {
      var created = false
      var ciphertext: ByteArray? = null
      try {
        check(); val store = owner.store(); val writing = staged != null; val encrypting = writing || authorizationOnly
        val key = if (writing) store.createKey(binding).also { created = true; createdAlias = true } else store.existingKey(binding)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        if (authorizationOnly && !store.present(binding)) credentialFailure("CREDENTIAL_MISSING")
        if (encrypting) cipher.init(Cipher.ENCRYPT_MODE, key)
        else {
          val record = store.read(binding) ?: credentialFailure("CREDENTIAL_MISSING")
          try { cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, record.copyOfRange(3, 15))); ciphertext = record.copyOfRange(15, record.size) }
          finally { record.fill(0) }
        }
        val ownedAlias = created
        credentialMain.post {
          try {
            check()
            if (Build.VERSION.SDK_INT < 30) credentialFailure()
            val prompt = BiometricPrompt.Builder(host ?: credentialFailure("CREDENTIAL_CANCELLED")).setTitle("Authorize access to Pali Wallet")
              .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL).build()
            // Only this OS-owned, still-unconsumed CryptoObject may span the system credential Activity.
            authenticating = true
            prompt.authenticate(BiometricPrompt.CryptoObject(cipher), cancellation, credentialExecutor,
              object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationError(code: Int, text: CharSequence?) {
                  if (!authenticationHandled.compareAndSet(false, true)) return
                  authenticating = false
                  val reason = if (cancelled.get()) "CREDENTIAL_CANCELLED" else if (code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED) "CREDENTIAL_USER_CANCELLED" else "CREDENTIAL_UNAVAILABLE"
                  finish(promise, null, PaliCredentialFailure(reason), ownedAlias, ciphertext)
                }
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                  if (!authenticationHandled.compareAndSet(false, true)) return
                  if (result.cryptoObject?.cipher !== cipher) { finish(promise, null, PaliCredentialFailure("CREDENTIAL_UNAVAILABLE"), ownedAlias, ciphertext); return }
                  whenForeground(promise, ownedAlias, ciphertext) {
                    var plaintext: ByteArray? = null
                    try {
                      check()
                      // updateAAD is a KeyMint operation too. It must consume
                      // the fresh authentication token, after OS success and
                      // foreground return, just like doFinal. The canonical
                      // request binding is immutable throughout this request.
                      cipher.updateAAD(binding.value.toByteArray(Charsets.US_ASCII))
                      if (authorizationOnly) {
                        val proof = cipher.doFinal(ByteArray(0)); proof.fill(0)
                        check(); finish(promise, null, null, false, ciphertext)
                      } else if (encrypting) {
                        val encrypted = cipher.doFinal(staged ?: credentialFailure())
                        try { val record = byteArrayOf(80, 67, 1) + cipher.iv + encrypted; try { check(); store.write(binding, record) } finally { record.fill(0) } }
                        finally { encrypted.fill(0) }
                        check(); finish(promise, null, null, false, ciphertext)
                      } else {
                        plaintext = cipher.doFinal(ciphertext ?: credentialFailure())
                        check(); if (!secretValid(plaintext!!)) credentialFailure()
                        val secretValue = plaintext.toString(Charsets.US_ASCII)
                        plaintext.fill(0); plaintext = null
                        finish(promise, secretValue, null, false, ciphertext)
                      }
                    } catch (error: Exception) { finish(promise, null, error, ownedAlias, ciphertext) }
                    finally { plaintext?.fill(0) }
                  }
                }
              })
          } catch (error: Exception) { authenticating = false; finish(promise, null, error, ownedAlias, ciphertext) }
        }
      } catch (error: Exception) { finish(promise, null, error, created, ciphertext) }
    }
  }
  private fun finish(promise: Promise, result: String?, error: Exception?, cleanup: Boolean, ciphertext: ByteArray?) {
    // Resolve on the UI queue. Completion and cancellation contend for one request claim.
    credentialMain.post {
      staged?.fill(0); staged = null; ciphertext?.fill(0)
      val permitted = owner.finish(this) ?: return@post
      var failure = error
      if (failure == null && (!permitted || !owner.foreground(host))) failure = PaliCredentialFailure("CREDENTIAL_CANCELLED")
      if (cleanup || (failure != null && createdAlias)) try { owner.store().remove(binding) } catch (error: Exception) { failure = error }
      host = null
      if (failure != null) reject(promise, failure) else promise.resolve(result)
    }
  }
  private fun reject(promise: Promise, error: Exception) { promise.reject((error as? PaliCredentialFailure)?.code ?: "CREDENTIAL_UNAVAILABLE", "Device authorization unavailable", null) }
  override fun sharedObjectDidRelease() { cancel() }
}
