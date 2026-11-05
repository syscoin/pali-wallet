package org.syscoin.pali.storage

import java.util.UUID

/** No reused request codes in this process; kept below the pinned Expo registry's 0x10000 floor. */
internal class PaliNoteBackupRequestCodes {
  companion object {
    private const val FIRST = 0x6000
    private const val END = 0x8000
    fun contains(code: Int) = code in FIRST until END
  }

  private var next = FIRST
  fun take(): Int? = if (contains(next)) next++ else null
}

/** Terminal Activity destruction is separate from a same-Activity React owner replacement. */
internal fun canReleaseNoteBackupPicker(
  working: Boolean, ownerRetired: Boolean, dismissalAdmitted: Boolean,
  previousActivity: Any?, previousDestroyed: Boolean, currentFocusedActivity: Any?
): Boolean = !working && (previousDestroyed ||
  (ownerRetired && dismissalAdmitted && previousActivity != null && previousActivity === currentFocusedActivity))

/** One process-local, owner-bound permission to dispatch one new-file create. */
internal class PaliNoteBackupDestinationPermit(private val owner: Any, private val issuedAt: Long) {
  companion object { const val LIFETIME_MS = 300_000L }
  private enum class State { SELECTED, WRITING, REVOKED }
  val token: String = UUID.randomUUID().toString()
  private var state = State.SELECTED
  private var admitted = false

  fun ownedBy(candidate: Any) = owner === candidate
  fun matches(candidate: Any, value: String) = ownedBy(candidate) && token == value

  @Synchronized fun begin(now: Long): Boolean {
    if (state != State.SELECTED || !live(now)) return false
    state = State.WRITING
    return true
  }

  @Synchronized fun check(now: Long) {
    if (state != State.WRITING || !live(now)) throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE)
  }

  @Synchronized fun admitCreate(now: Long, checkOwner: () -> Unit) {
    check(now)
    checkOwner()
    if (admitted) throw PaliNoteBackupFileException(PaliNoteBackupFileError.WRITE_UNCONFIRMED)
    admitted = true
  }

  @Synchronized fun createAdmitted(): Boolean = admitted

  @Synchronized fun revoke(): Boolean {
    state = State.REVOKED
    return admitted
  }

  private fun live(now: Long) = issuedAt >= 0 && now >= issuedAt && now - issuedAt < LIFETIME_MS
}
