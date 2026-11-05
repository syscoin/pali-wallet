package org.syscoin.pali.storage

private const val minBytes = 80
private const val maxBytes = 8 * 1024 * 1024 + minBytes

private fun fixture(size: Int): ByteArray = ByteArray(size) { (it * 19).toByte() }.also {
  "PALINOTE".encodeToByteArray().copyInto(it)
}

private fun readFixture(
  source: ByteArray,
  initialSize: Long = source.size.toLong(),
  finalSize: Long = initialSize,
  maxRead: Int = Int.MAX_VALUE,
  assertCurrent: () -> Unit = {},
  onRead: (ByteArray, Int) -> Unit = { _, _ -> }
): ByteArray = PaliNoteBackupFile.read(initialSize, assertCurrent, { output, offset, count, position ->
  onRead(output, count)
  val start = position.toInt()
  val length = minOf(count, maxRead, source.size - start)
  source.copyInto(output, offset, start, start + length)
  length
}, { finalSize })

private fun reject(expected: PaliNoteBackupFileError, read: () -> Unit) {
  try {
    read()
    error("Accepted an invalid backup")
  } catch (error: PaliNoteBackupFileException) {
    check(error.error == expected)
  }
}

fun main() {
  val minimum = fixture(minBytes)
  check(readFixture(minimum, maxRead = 1).contentEquals(minimum))
  val maximum = fixture(maxBytes)
  check(readFixture(maximum, onRead = { _, count -> check(count <= 64 * 1024) }).contentEquals(maximum))

  reject(PaliNoteBackupFileError.TOO_LARGE) {
    readFixture(minimum, initialSize = maxBytes + 1L, onRead = { _, _ -> error("Oversize reached provider") })
  }
  reject(PaliNoteBackupFileError.INVALID) {
    readFixture(minimum, initialSize = minBytes - 1L, onRead = { _, _ -> error("Short file reached provider") })
  }
  var retained: ByteArray? = null
  reject(PaliNoteBackupFileError.INVALID) {
    val wrongMagic = fixture(minBytes).also { it[2] = 0 }
    readFixture(wrongMagic, maxRead = 3, onRead = { bytes, _ -> retained = bytes })
  }
  check(retained!!.all { it == 0.toByte() })
  reject(PaliNoteBackupFileError.INVALID) { readFixture(minimum, initialSize = minBytes + 1L) }
  reject(PaliNoteBackupFileError.INVALID) { readFixture(minimum, finalSize = minBytes + 1L) }
  reject(PaliNoteBackupFileError.TOO_LARGE) { readFixture(maximum + 1.toByte(), initialSize = maxBytes.toLong()) }

  var reads = 0
  reject(PaliNoteBackupFileError.UNAVAILABLE) {
    readFixture(minimum, maxRead = 8, assertCurrent = {
      if (reads != 0) throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE)
    }, onRead = { _, _ -> reads++ })
  }
  check(reads == 1)
  println("9 Android encrypted-note bounded-reader checks passed")
}
