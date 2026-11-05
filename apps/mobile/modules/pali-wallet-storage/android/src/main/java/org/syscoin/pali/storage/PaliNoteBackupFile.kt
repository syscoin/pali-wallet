package org.syscoin.pali.storage

internal enum class PaliNoteBackupFileError(val code: String) {
  BUSY("NOTE_BACKUP_FILE_BUSY"),
  UNAVAILABLE("NOTE_BACKUP_FILE_UNAVAILABLE"),
  INVALID("NOTE_BACKUP_FILE_INVALID"),
  TOO_LARGE("NOTE_BACKUP_FILE_TOO_LARGE"),
  WRITE_UNCONFIRMED("NOTE_BACKUP_FILE_WRITE_UNCONFIRMED")
}

internal class PaliNoteBackupFileException(val error: PaliNoteBackupFileError) : Exception(error.code)

internal object PaliNoteBackupFile {
  // Match the shared noteBackup.ts header, ciphertext bound and GCM tag.
  private const val headerBytes = 64
  private const val minimumBytes = headerBytes + 16
  private const val maximumBytes = 8 * 1024 * 1024 + minimumBytes
  private const val chunkBytes = 64 * 1024
  private val magic = "PALINOTE".encodeToByteArray()

  /** Same v1 transport framing as inspectNoteBackupHeader, without doing cryptography here. */
  fun checkExport(bytes: ByteArray) {
    if (bytes.size > maximumBytes) throw PaliNoteBackupFileException(PaliNoteBackupFileError.TOO_LARGE)
    if (bytes.size < minimumBytes || magic.indices.any { bytes[it] != magic[it] } ||
      bytes[8] != 1.toByte() || bytes[9] != 1.toByte() || bytes[10] != 1.toByte() ||
      bytes[11] != 0.toByte() || (60 until 64).any { bytes[it] != 0.toByte() }
    ) throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
    var declared = 0L
    for (index in 56 until 60) declared = (declared shl 8) or (bytes[index].toLong() and 0xffL)
    if (declared != (bytes.size - headerBytes).toLong()) throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
  }

  fun write(bytes: ByteArray, check: () -> Unit, writeAt: (offset: Int, count: Int) -> Int) {
    var offset = 0
    while (offset < bytes.size) {
      check()
      val length = minOf(chunkBytes, bytes.size - offset)
      val count = writeAt(offset, length)
      if (count !in 1..length) throw PaliNoteBackupFileException(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
      offset += count
    }
  }

  fun verifyReadback(expected: ByteArray, actual: ByteArray, check: () -> Unit): ByteArray {
    try {
      check()
      if (!actual.contentEquals(expected)) throw PaliNoteBackupFileException(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
      check()
      return actual
    } catch (error: Exception) {
      actual.fill(0)
      throw error
    }
  }

  fun read(
    size: Long,
    assertCurrent: () -> Unit,
    readAt: (bytes: ByteArray, offset: Int, count: Int, position: Long) -> Int,
    finalSize: () -> Long
  ): ByteArray {
    if (size > maximumBytes) throw PaliNoteBackupFileException(PaliNoteBackupFileError.TOO_LARGE)
    if (size < minimumBytes) throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
    assertCurrent()
    val bytes = ByteArray(size.toInt())
    var accepted = false
    try {
      var offset = 0
      while (offset < bytes.size) {
        assertCurrent()
        val length = minOf(chunkBytes, bytes.size - offset)
        val count = readAt(bytes, offset, length, offset.toLong())
        if (count !in 1..length) throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
        val previous = offset
        offset += count
        // A transport sniff only. The shared codec validates framing and authentication.
        for (index in previous until minOf(offset, magic.size)) {
          if (bytes[index] != magic[index]) throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
        }
      }
      assertCurrent()
      val extra = readAt(ByteArray(1), 0, 1, size)
      val observedSize = finalSize()
      if (observedSize > maximumBytes || (size == maximumBytes.toLong() && extra > 0)) {
        throw PaliNoteBackupFileException(PaliNoteBackupFileError.TOO_LARGE)
      }
      if (extra != 0 || observedSize != size) {
        throw PaliNoteBackupFileException(PaliNoteBackupFileError.INVALID)
      }
      assertCurrent()
      accepted = true
      return bytes
    } finally {
      if (!accepted) bytes.fill(0)
    }
  }
}
