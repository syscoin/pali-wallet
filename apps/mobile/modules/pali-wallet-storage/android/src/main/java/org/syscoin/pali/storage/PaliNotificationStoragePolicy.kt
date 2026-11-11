package org.syscoin.pali.storage

import android.content.Context
import android.system.Os
import android.system.OsConstants
import java.io.File

/** Fixed no-backup directory for public monitoring data, separate from custody. */
internal object PaliNotificationStoragePolicy {
  private val names = setOf("activity-notifications.sqlite", "activity-notifications.sqlite-wal", "activity-notifications.sqlite-shm", "activity-notifications.sqlite-journal")
  private fun invalid(): Nothing = throw IllegalStateException("ALERT_STORAGE_UNAVAILABLE")
  private fun protect(file: File, directory: Boolean) {
    val stat = Os.lstat(file.absolutePath)
    if (directory) { if (!OsConstants.S_ISDIR(stat.st_mode)) invalid() }
    else if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size > 32L * 1024 * 1024) invalid()
    Os.chmod(file.absolutePath, if (directory) 448 else 384)
    if ((Os.lstat(file.absolutePath).st_mode and 511) != (if (directory) 448 else 384)) invalid()
  }
  @Synchronized fun prepare(context: Context, create: Boolean): Map<String, Any> {
    val directory = File(context.noBackupFilesDir.canonicalFile, "PaliActivityNotifications")
    if (directory.absolutePath != directory.canonicalPath) invalid()
    if (!directory.exists()) {
      if (!create) return mapOf("directory" to directory.absolutePath, "databaseExists" to false)
      if (!directory.mkdir()) invalid()
    }
    protect(directory, true)
    val children = directory.listFiles() ?: invalid()
    for (child in children) { if (!names.contains(child.name)) invalid(); protect(child, false) }
    val target = File(directory, "activity-notifications.sqlite")
    val existed = target.exists()
    if (!existed && children.isNotEmpty()) invalid()
    if (create && !existed) {
      val fd = Os.open(target.absolutePath, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_NOFOLLOW, 384)
      Os.close(fd); protect(target, false)
    }
    return mapOf("directory" to directory.absolutePath, "databaseExists" to existed)
  }
}
