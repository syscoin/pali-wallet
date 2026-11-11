package org.syscoin.pali.passkeys

import java.util.UUID

/** One-use native admission tickets; cancellation removes authority before queued work runs. */
internal class PaliPasskeyTickets<T>(private val nextId: () -> String = { UUID.randomUUID().toString() }) {
  private val entries = mutableMapOf<String, T>()
  private var closed = false

  @Synchronized fun prepare(value: (String) -> T): String {
    check(!closed && entries.size < 32) { "PASSKEY_UNAVAILABLE" }
    val id = nextId()
    check(id.isNotEmpty() && !entries.containsKey(id)) { "PASSKEY_UNAVAILABLE" }
    entries[id] = value(id)
    return id
  }

  @Synchronized fun remove(id: String): T? = entries.remove(id)

  @Synchronized fun clear(close: Boolean = false) {
    entries.clear()
    closed = closed || close
  }
}
