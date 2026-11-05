package org.syscoin.pali.storage

private fun envelope(size: Int): ByteArray = ByteArray(size).also { bytes ->
  "PALINOTE".encodeToByteArray().copyInto(bytes)
  for (index in 8..10) bytes[index] = 1
  val length = size - 64
  for (index in 0..3) bytes[56 + index] = (length ushr (24 - index * 8)).toByte()
}

private fun expect(expected: PaliNoteBackupFileError, action: () -> Unit) {
  try { action(); error("Accepted an invalid write") }
  catch (error: PaliNoteBackupFileException) { check(error.error == expected) }
}

fun main() {
  val minimum = envelope(80)
  val cap = 8 * 1024 * 1024 + 80
  val maximum = envelope(cap)
  PaliNoteBackupFile.checkExport(minimum)
  PaliNoteBackupFile.checkExport(maximum)
  expect(PaliNoteBackupFileError.TOO_LARGE) { PaliNoteBackupFile.checkExport(envelope(cap + 1)) }
  expect(PaliNoteBackupFileError.INVALID) { PaliNoteBackupFile.checkExport(envelope(79)) }
  for (index in listOf(0, 8, 9, 10, 11, 56, 57, 58, 59, 60, 61, 62, 63)) {
    val invalid = minimum.copyOf().also { it[index] = (it[index] + 1).toByte() }
    expect(PaliNoteBackupFileError.INVALID) { PaliNoteBackupFile.checkExport(invalid) }
  }

  var written = 0
  PaliNoteBackupFile.write(maximum, {}) { offset, count ->
    check(offset == written && count <= 64 * 1024)
    val part = minOf(count, 17 * 1024)
    written += part
    part
  }
  check(written == cap)
  expect(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupFile.write(minimum, {}) { _, _ -> 0 } }
  expect(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupFile.write(minimum, {}) { _, count -> count + 1 } }
  var attempted = 0
  expect(PaliNoteBackupFileError.UNAVAILABLE) {
    PaliNoteBackupFile.write(minimum, {
      if (attempted != 0) throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE)
    }) { _, _ -> attempted++; 1 }
  }
  check(attempted == 1)

  val equal = minimum.copyOf()
  check(PaliNoteBackupFile.verifyReadback(minimum, equal, {}) === equal)
  val different = minimum.copyOf().also { it[79] = 42 }
  expect(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupFile.verifyReadback(minimum, different, {}) }
  check(different.all { it == 0.toByte() })

  val owner = Any()
  val selected = PaliNoteBackupDestinationPermit(owner, 100)
  check(selected.matches(owner, selected.token) && !selected.matches(Any(), selected.token))
  check(!selected.matches(owner, "wrong") && !selected.begin(99))
  check(selected.begin(100) && !selected.begin(100))
  expect(PaliNoteBackupFileError.UNAVAILABLE) {
    selected.admitCreate(100) { throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE) }
  }
  check(!selected.createAdmitted())
  selected.admitCreate(100) {}
  check(selected.createAdmitted() && selected.revoke())
  expect(PaliNoteBackupFileError.UNAVAILABLE) { selected.check(100) }

  val expired = PaliNoteBackupDestinationPermit(owner, 100)
  check(!expired.begin(100 + PaliNoteBackupDestinationPermit.LIFETIME_MS))
  val cancelled = PaliNoteBackupDestinationPermit(owner, 100)
  check(cancelled.begin(100) && !cancelled.revoke())
  expect(PaliNoteBackupFileError.UNAVAILABLE) { cancelled.admitCreate(100) {} }

  val requestCodes = PaliNoteBackupRequestCodes()
  for (code in 0x6000 until 0x8000) check(requestCodes.take() == code)
  check(requestCodes.take() == null && requestCodes.take() == null)
  check(!PaliNoteBackupRequestCodes.contains(0x5fff) && PaliNoteBackupRequestCodes.contains(0x7fff))
  check(!PaliNoteBackupRequestCodes.contains(0x8000) && !PaliNoteBackupRequestCodes.contains(0x10000))

  val activity = Any()
  check(canReleaseNoteBackupPicker(false, true, true, activity, false, activity))
  check(!canReleaseNoteBackupPicker(false, true, false, activity, false, activity))
  check(!canReleaseNoteBackupPicker(false, false, true, activity, false, activity))
  check(!canReleaseNoteBackupPicker(false, true, true, activity, false, null))
  check(!canReleaseNoteBackupPicker(false, true, true, activity, false, Any()))
  check(canReleaseNoteBackupPicker(false, false, false, activity, true, null))
  check(!canReleaseNoteBackupPicker(true, true, true, activity, true, activity))
  println("Android encrypted-note export checks passed")
}
