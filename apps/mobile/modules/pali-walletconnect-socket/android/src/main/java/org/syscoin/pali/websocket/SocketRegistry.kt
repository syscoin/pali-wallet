package org.syscoin.pali.websocket

import okhttp3.WebSocket

/** A slot remains owned until the transport reports its terminal callback. */
internal class SocketRegistry(private val limit: Int = 8) {
  internal class Connection(val id: String) {
    var socket: WebSocket? = null
    var opened = false
    var closing = false
    var finished = false
  }

  private val connections = mutableMapOf<String, Connection>()
  private var retired = false

  @Synchronized fun create(id: String): Connection {
    check(!retired && connections.size < limit && !connections.containsKey(id))
    return Connection(id).also { connections[id] = it }
  }

  fun attach(connection: Connection, socket: WebSocket) {
    val cancel = synchronized(this) {
      if (connections[connection.id] !== connection || connection.finished ||
        (connection.closing && (!connection.opened || connection.socket !== socket))) {
        true
      } else {
        check(connection.socket == null || connection.socket === socket)
        connection.socket = socket
        false
      }
    }
    if (cancel) socket.cancel()
  }

  fun opened(connection: Connection, socket: WebSocket): Boolean {
    val accepted = synchronized(this) {
      if (connections[connection.id] !== connection || connection.finished || connection.closing ||
        (connection.socket != null && connection.socket !== socket)) {
        false
      } else {
        connection.socket = socket
        connection.opened = true
        true
      }
    }
    if (!accepted) socket.cancel()
    return accepted
  }

  @Synchronized fun readable(connection: Connection, socket: WebSocket): Boolean =
    connections[connection.id] === connection && connection.socket === socket &&
      connection.opened && !connection.closing && !connection.finished

  @Synchronized fun openSocket(id: String): WebSocket? {
    val connection = connections[id] ?: return null
    return if (connection.opened && !connection.closing && !connection.finished) connection.socket else null
  }

  fun close(id: String, code: Int, reason: String) {
    val action = synchronized(this) {
      val connection = connections[id] ?: return
      if (connection.closing || connection.finished) return
      connection.closing = true
      Pair(connection.socket, connection.opened)
    }
    val socket = action.first ?: return // attach() cancels a handle that arrives later.
    if (action.second) socket.close(code, reason) else socket.cancel()
  }

  @Synchronized fun finish(connection: Connection, socket: WebSocket?): Boolean {
    if (connections[connection.id] !== connection || connection.finished ||
      (connection.socket != null && socket != null && connection.socket !== socket)) return false
    connection.finished = true
    connections.remove(connection.id)
    return true
  }

  fun invalidate() {
    val sockets = synchronized(this) {
      retired = true
      connections.values.mapNotNull { connection ->
        connection.finished = true
        connection.closing = true
        connection.socket
      }.also { connections.clear() }
    }
    sockets.forEach { it.cancel() }
  }
}
