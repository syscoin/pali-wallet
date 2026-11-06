package org.syscoin.pali.storage

import java.util.UUID

/** One Expo module owns one exact handle until transport and result retirement. */
internal class PaliPublicSnapshotBridge {
  private class Entry {
    val token = UUID.randomUUID().toString()
    var operation: PaliPublicSnapshotOperation? = null
    var result: Result<Unit>? = null
    var start: ((Result<PaliPublicSnapshotInfo>) -> Unit)? = null
    var release: (() -> Unit)? = null
    var started = false
    var retiring = false
  }

  // Native completion can reenter synchronously while retiring a reservation.
  private val lock = Any()
  private var active: Entry? = null
  private var closed = false

  fun prepare(reserve: ((Result<Unit>) -> Unit) -> PaliPublicSnapshotOperation): String = synchronized(lock) {
    if (closed) fail(PaliPublicSnapshotError.CANCELLED)
    if (active != null) fail(PaliPublicSnapshotError.BUSY)
    val entry = Entry()
    val token = entry.token
    active = entry
    try {
      entry.operation = reserve { result -> finish(token, result) }
      token
    } catch (error: Exception) {
      active = null
      throw error
    }
  }

  fun start(token: String, completion: (Result<PaliPublicSnapshotInfo>) -> Unit) = synchronized(lock) {
    val entry = current(token)
    val operation = entry.operation ?: fail(PaliPublicSnapshotError.INVALID)
    if (entry.started) fail(PaliPublicSnapshotError.INVALID)
    entry.started = true
    entry.start = completion
    if (entry.result == null) operation.start() else settleStart(entry)
  }

  fun pull(token: String): ByteArray? = synchronized(lock) {
    val entry = current(token)
    val operation = entry.operation ?: fail(PaliPublicSnapshotError.INVALID)
    if (!entry.started) fail(PaliPublicSnapshotError.INVALID)
    operation.pull()
  }

  fun release(token: String, completion: () -> Unit) = synchronized(lock) {
    val entry = active
    if (entry == null || entry.token != token) {
      completion()
      return@synchronized
    }
    if (entry.release != null) fail(PaliPublicSnapshotError.INVALID)
    entry.release = completion
    retire(entry)
  }

  fun cancelActive() = synchronized(lock) {
    active?.let(::retire)
  }

  fun close() = synchronized(lock) {
    closed = true
    active?.let(::retire)
  }

  private fun current(token: String): Entry {
    val entry = active
    if (closed || entry == null || entry.token != token || entry.retiring) {
      fail(PaliPublicSnapshotError.CANCELLED)
    }
    return entry
  }

  private fun finish(token: String, result: Result<Unit>) = synchronized(lock) {
    val entry = active ?: return@synchronized
    if (entry.token != token || entry.result != null) return@synchronized
    entry.result = result
    try { settleStart(entry) }
    finally { settleRetirement(entry) }
  }

  private fun settleStart(entry: Entry) {
    val result = entry.result ?: return
    val completion = entry.start ?: return
    entry.start = null
    if (entry.retiring || closed) {
      completion(Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.CANCELLED)))
    } else {
      completion(result.mapCatching { entry.operation?.info() ?: fail(PaliPublicSnapshotError.UNAVAILABLE) })
    }
  }

  private fun retire(entry: Entry) {
    if (!entry.retiring) {
      entry.retiring = true
      entry.operation?.cancel()
    }
    settleRetirement(entry)
  }

  private fun settleRetirement(entry: Entry) {
    if (active !== entry || !entry.retiring || entry.result == null) return
    active = null
    val completion = entry.release
    entry.release = null
    completion?.invoke()
  }

  private fun fail(error: PaliPublicSnapshotError): Nothing = throw PaliPublicSnapshotException(error)
}
