package org.syscoin.pali.storage

import android.system.Os
import android.system.OsConstants
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.jni.ArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

class PaliWalletStorageModule : Module() {
  private var protectedCredentials: PaliCredentialOwner? = null
  private fun credentials(): PaliCredentialOwner = protectedCredentials ?: synchronized(this) {
    protectedCredentials ?: PaliCredentialOwner(requireNotNull(appContext.reactContext).applicationContext) { appContext.currentActivity }.also { protectedCredentials = it }
  }
  private val noteBackupPickerOwner = PaliNoteBackupPicker.Owner()
  private val publicSnapshots = PaliPublicSnapshotBridge()

  companion object {
    private val mutex = Any()
    private var lease: String? = null
    private val allowedNames = setOf("wallet.sqlite", "wallet.sqlite-wal", "wallet.sqlite-shm", "wallet.sqlite-journal")
  }

  private fun failure(): Nothing = throw IllegalStateException("STORAGE_UNAVAILABLE")

  private fun snapshotInteger(value: Double): Long {
    if (value < 1 || value > 9_007_199_254_740_991.0 || value.toLong().toDouble() != value)
      throw PaliPublicSnapshotException(PaliPublicSnapshotError.INVALID)
    return value.toLong()
  }

  private fun rejectSnapshot(promise: Promise, error: Throwable) {
    val code = (error as? PaliPublicSnapshotException)?.error ?: PaliPublicSnapshotError.UNAVAILABLE
    promise.reject(code.code, "Public snapshot unavailable", null)
  }

  private fun directory(): File {
    val context = appContext.reactContext ?: failure()
    val parent = context.noBackupFilesDir.canonicalFile
    val target = File(parent, "PaliWallet")
    if (target.canonicalPath != target.absolutePath) failure()
    return target
  }

  private fun protect(file: File, directory: Boolean) {
    val stat = Os.lstat(file.absolutePath)
    if (directory) {
      if (!OsConstants.S_ISDIR(stat.st_mode)) failure()
    } else if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size > 64L * 1024 * 1024) failure()
    Os.chmod(file.absolutePath, if (directory) 448 else 384) // 0700 / 0600
    val verified = Os.lstat(file.absolutePath)
    if ((verified.st_mode and 511) != (if (directory) 448 else 384)) failure()
  }

  private fun inspect(token: String): Map<String, Any> {
    if (lease != token) failure()
    val directory = directory()
    protect(directory, true)
    val children = directory.listFiles() ?: failure()
    var present = false
    for (child in children) {
      if (!allowedNames.contains(child.name)) failure()
      protect(child, false)
      if (child.name == "wallet.sqlite") present = true
    }
    if (!present && children.isNotEmpty()) failure()
    return mapOf("token" to token, "directory" to directory.absolutePath, "databaseExists" to present)
  }

  override fun definition() = ModuleDefinition {
    Name("PaliWalletStorage")
    Function("isCredentialPromptActive") { protectedCredentials?.isAuthenticating() == true }
    Function("credentialCapabilities") { binding: String? -> credentials().capabilities(binding) }
    Function("prepareViewAuthorization") { PaliCredentialRequest(credentials()) }
    Function("prepareCredentialAuthorization") { binding: String -> PaliCredentialRequest(credentials(), binding, authorizationOnly = true) }
    Function("prepareCredentialRead") { binding: String -> PaliCredentialRequest(credentials(), binding) }
    Function("prepareCredentialStage") { binding: String, secret: String -> PaliCredentialRequest(credentials(), binding, secret) }
    AsyncFunction("removeCredential") { binding: String -> credentials().remove(binding) }
    Class("CredentialRequest", PaliCredentialRequest::class) {
      Constructor { throw PaliCredentialFailure("CREDENTIAL_UNAVAILABLE") }
      Function("cancel") { request: PaliCredentialRequest -> request.cancel() }
      AsyncFunction("run") { request: PaliCredentialRequest, promise: Promise -> request.run(promise) }
    }
    AsyncFunction("prepareNotificationStorage") { create: Boolean ->
      PaliNotificationStoragePolicy.prepare(appContext.reactContext ?: failure(), create)
    }
    AsyncFunction("protectNotificationStorage") {
      PaliNotificationStoragePolicy.prepare(appContext.reactContext ?: failure(), false)
      Unit
    }
    Function("preparePublicSnapshot") { pool: String, serviceOrigin: String ->
      publicSnapshots.prepare { PaliPublicSnapshotDownloader.prepare(pool, serviceOrigin, it) }
    }
    Function("preparePublicSnapshotAnchor") {
      endpoint: String, address: String, block: Double, root: String, kind: String, id: Double ->
      val read = when (kind) {
        "chainId" -> PaliPublicSnapshotAnchor.Read.CHAIN_ID
        "block" -> PaliPublicSnapshotAnchor.Read.BLOCK
        "nextIndex" -> PaliPublicSnapshotAnchor.Read.NEXT_INDEX
        "getLastRoot" -> PaliPublicSnapshotAnchor.Read.LAST_ROOT
        "levels" -> PaliPublicSnapshotAnchor.Read.LEVELS
        "denomination" -> PaliPublicSnapshotAnchor.Read.DENOMINATION
        "isKnownRoot" -> PaliPublicSnapshotAnchor.Read.KNOWN_ROOT
        else -> throw PaliPublicSnapshotException(PaliPublicSnapshotError.INVALID)
      }
      val anchor = PaliPublicSnapshotAnchor(endpoint, address, snapshotInteger(block), root)
      val requestId = snapshotInteger(id)
      publicSnapshots.prepare { PaliPublicSnapshotDownloader.prepareAnchor(anchor, read, requestId, it) }
    }
    AsyncFunction("startPublicSnapshot") { token: String, promise: Promise ->
      try {
        val reactContext = appContext.reactContext as? ReactContext
        if (appContext.currentActivity == null || reactContext?.lifecycleState != LifecycleState.RESUMED)
          throw PaliPublicSnapshotException(PaliPublicSnapshotError.CANCELLED)
        publicSnapshots.start(token) { result ->
          result.fold(
            { info -> promise.resolve(mapOf("status" to info.status, "byteCount" to info.byteCount)) },
            { error -> rejectSnapshot(promise, error) }
          )
        }
      } catch (error: Exception) { rejectSnapshot(promise, error) }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pullPublicSnapshot") { token: String ->
      publicSnapshots.pull(token)?.let { ArrayBuffer.copyOf(ByteBuffer.wrap(it)) }
    }
    AsyncFunction("releasePublicSnapshot") { token: String, promise: Promise ->
      try { publicSnapshots.release(token) { promise.resolve(null) } }
      catch (error: Exception) { rejectSnapshot(promise, error) }
    }
    OnActivityEntersBackground { publicSnapshots.cancelActive(); protectedCredentials?.background() }
    AsyncFunction("pickEncryptedNoteBackup") { promise: Promise ->
      val activity = appContext.currentActivity.takeIf { appContext.hasActiveReactInstance }
      PaliNoteBackupPicker.pick(noteBackupPickerOwner, activity, false, promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pickEncryptedNoteBackupDestination") { promise: Promise ->
      val activity = appContext.currentActivity.takeIf { appContext.hasActiveReactInstance }
      PaliNoteBackupPicker.pick(noteBackupPickerOwner, activity, true, promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("writeEncryptedNoteBackup") { token: String, bytes: ByteArray, promise: Promise ->
      PaliNoteBackupPicker.write(noteBackupPickerOwner, token, bytes, promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("revokeEncryptedNoteBackupDestination") { token: String ->
      PaliNoteBackupPicker.revokeDestination(noteBackupPickerOwner, token)
    }.runOnQueue(Queues.MAIN)
    OnActivityResult { activity, result ->
      PaliNoteBackupPicker.receive(noteBackupPickerOwner, activity, result.requestCode, result.resultCode, result.data)
    }
    OnActivityDestroys { PaliNoteBackupPicker.activityDestroyed(noteBackupPickerOwner) }
    OnDestroy {
      protectedCredentials?.close()
      publicSnapshots.close()
      PaliNoteBackupPicker.invalidate(noteBackupPickerOwner)
    }

    AsyncFunction("acquire") {
      synchronized(mutex) {
        if (lease != null) failure()
        val token = UUID.randomUUID().toString()
        lease = token
        try {
          val directory = directory()
          if (!directory.exists() && !directory.mkdir()) failure()
          inspect(token)
        } catch (_: Exception) {
          lease = null
          failure()
        }
      }
    }
    AsyncFunction("inspect") { token: String ->
      synchronized(mutex) {
        try { inspect(token) } catch (_: Exception) { failure() }
      }
    }
    AsyncFunction("createDatabase") { token: String ->
      synchronized(mutex) {
        try {
          if (inspect(token)["databaseExists"] != false) failure()
          val target = File(directory(), "wallet.sqlite")
          // O_EXCL ensures this cannot truncate or follow an existing file.
          val descriptor = Os.open(target.absolutePath, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_NOFOLLOW, 384)
          Os.close(descriptor)
          protect(target, false)
        } catch (_: Exception) { failure() }
      }
    }
    AsyncFunction("protect") { token: String ->
      synchronized(mutex) {
        try { inspect(token); Unit } catch (_: Exception) { failure() }
      }
    }
    AsyncFunction("release") { token: String ->
      synchronized(mutex) {
        if (lease != token) failure()
        lease = null
      }
    }
  }
}
