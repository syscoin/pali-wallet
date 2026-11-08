package org.syscoin.pali.websocket

import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test

class SocketRegistryTest {
  private class Socket : WebSocket {
    var cancellations = 0
    var closes = 0
    override fun request() = Request.Builder().url("https://localhost/").build()
    override fun queueSize() = 0L
    override fun send(text: String) = true
    override fun send(bytes: ByteString) = true
    override fun close(code: Int, reason: String?): Boolean { closes++; return true }
    override fun cancel() { cancellations++ }
  }

  @Test fun closeBeforeAttachCancelsReturnedHandle() {
    val registry = SocketRegistry()
    val connection = registry.create("one")
    val socket = Socket()
    registry.close("one", 1000, "")
    registry.attach(connection, socket)
    assertEquals(1, socket.cancellations)
    assertEquals(0, socket.closes)
    assertFalse(registry.opened(connection, socket))
    assertNull(registry.openSocket("one"))
    assertTrue(registry.finish(connection, socket))
    assertFalse(registry.finish(connection, socket))
  }

  @Test fun attachedConnectingHandleIsCancelledWithoutWaitingForUpgrade() {
    val registry = SocketRegistry()
    val connection = registry.create("one")
    val socket = Socket()
    registry.attach(connection, socket)
    registry.close("one", 1000, "")
    registry.close("one", 1000, "")
    assertEquals(1, socket.cancellations)
    assertEquals(0, socket.closes)
  }

  @Test fun openBeforeAttachUsesNormalCloseAndCannotBeReattached() {
    val registry = SocketRegistry()
    val connection = registry.create("one")
    val socket = Socket()
    assertTrue(registry.opened(connection, socket))
    registry.attach(connection, socket)
    assertSame(socket, registry.openSocket("one"))
    registry.close("one", 1000, "done")
    assertEquals(1, socket.closes)
    assertNull(registry.openSocket("one"))
    assertFalse(registry.readable(connection, socket))
  }

  @Test fun closeAfterOpenBeforeAttachKeepsTheGracefulClose() {
    val registry = SocketRegistry()
    val connection = registry.create("one")
    val socket = Socket()
    assertTrue(registry.opened(connection, socket))
    registry.close("one", 1000, "done")
    assertEquals(1, socket.closes)
    registry.attach(connection, socket)
    assertEquals(0, socket.cancellations)
    assertEquals(1, socket.closes)
    assertNull(registry.openSocket("one"))
    assertTrue(registry.finish(connection, socket))
    assertFalse(registry.finish(connection, socket))
  }

  @Test fun failureBeforeHandleReturnCannotReinsertOldConnection() {
    val registry = SocketRegistry()
    val old = registry.create("one")
    assertTrue(registry.finish(old, null))
    val current = registry.create("one")
    val oldSocket = Socket()
    registry.attach(old, oldSocket)
    assertEquals(1, oldSocket.cancellations)
    assertFalse(registry.opened(old, oldSocket))
    assertFalse(registry.finish(old, oldSocket))
    val socket = Socket()
    registry.attach(current, socket)
    assertTrue(registry.opened(current, socket))
    assertSame(socket, registry.openSocket("one"))
  }

  @Test fun closingSlotRemainsBoundedUntilActualTerminalCallback() {
    val registry = SocketRegistry(1)
    val connection = registry.create("one")
    registry.close("one", 1000, "")
    try { registry.create("two"); fail("Pending cleanup released capacity") } catch (_: IllegalStateException) {}
    assertTrue(registry.finish(connection, null))
    registry.create("two")
  }

  @Test fun invalidationCancelsPendingAndOpenAndLateHandles() {
    val registry = SocketRegistry()
    val pending = registry.create("pending")
    val open = registry.create("open")
    val pendingSocket = Socket()
    val openSocket = Socket()
    registry.attach(pending, pendingSocket)
    registry.opened(open, openSocket)
    registry.invalidate()
    assertEquals(1, pendingSocket.cancellations)
    assertEquals(1, openSocket.cancellations)
    assertFalse(registry.opened(pending, pendingSocket))
    assertFalse(registry.finish(open, openSocket))
    try { registry.create("new"); fail("Retired registry reopened") } catch (_: IllegalStateException) {}
  }

  @Test fun competingTerminalCallbacksPublishOnce() {
    val registry = SocketRegistry()
    val connection = registry.create("one")
    val socket = Socket()
    registry.attach(connection, socket)
    val start = CountDownLatch(1)
    val published = AtomicInteger()
    val callbacks = List(2) { Thread { start.await(); if (registry.finish(connection, socket)) published.incrementAndGet() } }
    callbacks.forEach { it.start() }
    start.countDown()
    callbacks.forEach { it.join() }
    assertEquals(1, published.get())
  }
}
