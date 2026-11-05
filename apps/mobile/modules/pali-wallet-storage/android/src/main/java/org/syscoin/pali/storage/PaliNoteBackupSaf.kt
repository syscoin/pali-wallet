package org.syscoin.pali.storage

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.CancellationSignal
import android.os.SystemClock
import android.provider.DocumentsContract
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.system.StructStat
import java.io.FileDescriptor
import java.util.UUID

internal object PaliNoteBackupSaf {
  class Destination(val permit: PaliNoteBackupDestinationPermit, val context: Context, val tree: Uri, val parent: Uri)

  private val authority = Regex("[A-Za-z0-9_.-]+")
  private const val segment = "(?:[A-Za-z0-9_.~!()*'-]|%[0-9a-fA-F]{2})+"
  private val documentPath = Regex("/document/$segment")
  private val treePath = Regex("/tree/$segment")
  private val childPath = Regex("/tree/$segment/document/$segment")
  private const val readGrant = Intent.FLAG_GRANT_READ_URI_PERMISSION
  private val directoryGrant = readGrant or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

  fun pickerIntent(directory: Boolean): Intent = if (directory) {
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(directoryGrant)
  } else {
    Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      addFlags(readGrant)
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
    }
  }

  fun selection(result: Int, intent: Intent?, directory: Boolean): Uri? {
    if (result != Activity.RESULT_OK || intent == null) return null
    return try {
      val grant = if (directory) directoryGrant or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION else readGrant
      val direct = intent.data
      val clip = intent.clipData
      if ((intent.flags and grant) != grant || (clip != null && clip.itemCount != 1)) return null
      val clipped = clip?.getItemAt(0)?.uri
      if (clip != null && (clipped == null || (direct != null && direct != clipped))) return null
      val uri = direct ?: clipped ?: return null
      val path = if (directory) treePath else documentPath
      if (!hasShape(uri, path)) return null
      val id = if (directory) DocumentsContract.getTreeDocumentId(uri) else DocumentsContract.getDocumentId(uri)
      if (validId(id)) uri else null
    } catch (_: Exception) {
      null
    }
  }

  private fun hasShape(uri: Uri, path: Regex): Boolean =
    uri.toString().length <= 4096 && uri.scheme == "content" &&
      authority.matches(uri.encodedAuthority.orEmpty()) && path.matches(uri.encodedPath.orEmpty()) &&
      uri.encodedQuery == null && uri.encodedFragment == null

  private fun validId(id: String): Boolean = id.isNotEmpty() &&
    id.none { Character.isISOControl(it) || it == '\\' } && id.split('/', ':').none { it == "." || it == ".." }

  fun destination(
    context: Context, owner: Any, uri: Uri, signal: CancellationSignal, check: () -> Unit
  ): Destination {
    check()
    val parent = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
    if (!DocumentsContract.isDocumentUri(context, parent)) fail(PaliNoteBackupFileError.INVALID)
    check()
    val fields = arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS)
    val writableDirectory = context.contentResolver.query(parent, fields, null, null, null, signal)?.use {
      it.moveToFirst() && it.getString(it.getColumnIndexOrThrow(fields[0])) == DocumentsContract.Document.MIME_TYPE_DIR &&
        (it.getInt(it.getColumnIndexOrThrow(fields[1])) and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) != 0
    } == true
    check()
    if (!writableDirectory) fail(PaliNoteBackupFileError.UNAVAILABLE)
    return Destination(PaliNoteBackupDestinationPermit(owner, SystemClock.elapsedRealtime()), context, uri, parent)
  }

  fun read(context: Context, uri: Uri, signal: CancellationSignal, check: () -> Unit): ByteArray {
    check()
    if (!DocumentsContract.isDocumentUri(context, uri)) fail(PaliNoteBackupFileError.INVALID)
    return readFile(context.contentResolver, uri, signal, check)
  }

  fun write(selected: Destination, bytes: ByteArray, signal: CancellationSignal, checkOwner: () -> Unit): ByteArray {
    val permit = selected.permit
    fun check() {
      checkOwner()
      permit.check(SystemClock.elapsedRealtime())
    }
    check()
    val resolver = selected.context.contentResolver
    val name = "pali-private-notes-${UUID.randomUUID()}.palibak"
    permit.admitCreate(SystemClock.elapsedRealtime(), checkOwner)
    // DocumentsProvider.createDocument must allocate a new opaque ID. Never target an existing path.
    val child = DocumentsContract.createDocument(resolver, selected.parent, "application/octet-stream", name)
      ?: fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
    check()
    val root = DocumentsContract.getTreeDocumentId(selected.tree)
    if (!hasShape(child, childPath) || child.encodedAuthority != selected.tree.encodedAuthority ||
      DocumentsContract.getTreeDocumentId(child) != root || !DocumentsContract.isDocumentUri(selected.context, child)
    ) fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
    val id = DocumentsContract.getDocumentId(child)
    if (id == root || !validId(id)) fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)

    check()
    // Pin the original inode until after the writer closes and independent readback completes.
    return open(resolver, child, "r", signal).use { anchor ->
      val identity = ensureEmpty(anchor.fileDescriptor, ::check)
      check()
      // "rw" requests no truncation and a seekable file. Recheck before the first byte is written.
      open(resolver, child, "rw", signal).use {
        val fd = it.fileDescriptor
        if (!sameFile(identity, ensureEmpty(fd, ::check))) fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
        PaliNoteBackupFile.write(bytes, ::check) { offset, count ->
          retryInterrupted(::check) { Os.pwrite(fd, bytes, offset, count, offset.toLong()) }
        }
        check()
        retryInterrupted(::check) { Os.fsync(fd) }
        if (Os.fstat(fd).st_size != bytes.size.toLong()) fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
      }
      val readback = readFile(resolver, child, signal, ::check, identity, bytes.size)
      PaliNoteBackupFile.verifyReadback(bytes, readback, ::check)
    }
  }

  private fun readFile(
    resolver: ContentResolver, uri: Uri, signal: CancellationSignal, check: () -> Unit,
    identity: StructStat? = null, length: Int? = null
  ): ByteArray {
    check()
    return open(resolver, uri, "r", signal).use {
      val fd = it.fileDescriptor
      check()
      val stat = regularFile(fd)
      if ((identity != null && !sameFile(identity, stat)) || (length != null && stat.st_size != length.toLong())) {
        fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
      }
      PaliNoteBackupFile.read(stat.st_size, check, { bytes, offset, count, position ->
        retryInterrupted(check) { Os.pread(fd, bytes, offset, count, position) }
      }, { Os.fstat(fd).st_size })
    }
  }

  private fun open(resolver: ContentResolver, uri: Uri, mode: String, signal: CancellationSignal) =
    resolver.openFileDescriptor(uri, mode, signal) ?: fail(PaliNoteBackupFileError.UNAVAILABLE)

  private fun regularFile(fd: FileDescriptor): StructStat = Os.fstat(fd).also {
    if (!OsConstants.S_ISREG(it.st_mode)) fail(PaliNoteBackupFileError.INVALID)
  }

  private fun ensureEmpty(fd: FileDescriptor, check: () -> Unit): StructStat {
    check()
    val stat = regularFile(fd)
    if (stat.st_size != 0L || retryInterrupted(check) { Os.pread(fd, ByteArray(1), 0, 1, 0L) } != 0) {
      fail(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
    }
    return stat
  }

  private fun sameFile(first: StructStat, second: StructStat): Boolean =
    first.st_dev == second.st_dev && first.st_ino == second.st_ino

  private inline fun <T> retryInterrupted(check: () -> Unit, action: () -> T): T {
    while (true) {
      try { return action() }
      catch (error: ErrnoException) {
        if (error.errno != OsConstants.EINTR) throw error
        check()
      }
    }
  }

  private fun fail(error: PaliNoteBackupFileError): Nothing = throw PaliNoteBackupFileException(error)
}
