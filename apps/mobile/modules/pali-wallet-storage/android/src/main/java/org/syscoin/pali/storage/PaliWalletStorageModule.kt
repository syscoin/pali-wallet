package org.syscoin.pali.storage

import android.system.Os
import android.system.OsConstants
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class PaliWalletStorageModule : Module() {
  private val noteBackupPickerOwner = PaliNoteBackupPicker.Owner()

  companion object {
    private val mutex = Any()
    private var lease: String? = null
    private val allowedNames = setOf("wallet.sqlite", "wallet.sqlite-wal", "wallet.sqlite-shm", "wallet.sqlite-journal")
  }

  private fun failure(): Nothing = throw IllegalStateException("STORAGE_UNAVAILABLE")

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
    OnDestroy { PaliNoteBackupPicker.invalidate(noteBackupPickerOwner) }

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
