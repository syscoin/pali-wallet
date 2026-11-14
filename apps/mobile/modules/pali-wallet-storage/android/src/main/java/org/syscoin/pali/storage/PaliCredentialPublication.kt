package org.syscoin.pali.storage

import android.system.ErrnoException
import android.system.OsConstants
import java.io.File

/** Atomic first publication: Android app domains cannot create hard links. */
internal object PaliCredentialPublication {
  private val available = try { System.loadLibrary("pali_credential_publication"); true } catch (_: LinkageError) { false }

  @JvmStatic private external fun renameNoReplace(directory: String, stem: String): Int

  fun publish(directory: File, stem: String) {
    val error = if (available) {
      try { renameNoReplace(directory.absolutePath, stem) } catch (_: LinkageError) { OsConstants.ENOSYS }
    } else OsConstants.ENOSYS
    if (error != 0) throw ErrnoException("publishCredential", error)
  }
}
