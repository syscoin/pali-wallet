package org.syscoin.pali.passkeys

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class PaliPasskeyTicketsTest {
  @Test fun cancellationBeforeQueuedStartCannotRecreateAuthority() {
    val tickets = PaliPasskeyTickets<Any>()
    val owner = Any()
    val id = tickets.prepare { owner }
    assertSame(owner, tickets.remove(id)) // Synchronous cancellation.
    assertNull(tickets.remove(id)) // The subsequently queued native start.
    assertNull(tickets.remove("unprepared"))
  }

  @Test fun admissionIsOneUseAndKeepsTheCapturedOwner() {
    val tickets = PaliPasskeyTickets<Any>()
    val firstOwner = Any()
    val secondOwner = Any()
    val first = tickets.prepare { firstOwner }
    val second = tickets.prepare { secondOwner }
    assertNotEquals(first, second)
    assertSame(firstOwner, tickets.remove(first))
    assertNull(tickets.remove(first))
    assertSame(secondOwner, tickets.remove(second))
  }

  @Test fun capacityFailsClosedWithoutEvictingEarlierTickets() {
    val tickets = PaliPasskeyTickets<Int>()
    val ids = (0 until 32).map { value -> tickets.prepare { value } }
    try { tickets.prepare { 33 }; fail("The 33rd unused ticket was accepted") } catch (_: IllegalStateException) { }
    ids.forEachIndexed { index, id -> assertEquals(index, tickets.remove(id)) }
    assertNotNull(tickets.prepare { 34 })
  }

  @Test fun competingStartsCanConsumeATicketOnlyOnce() {
    val tickets = PaliPasskeyTickets<Any>()
    val id = tickets.prepare { Any() }
    val gate = CountDownLatch(1)
    val consumed = AtomicInteger()
    val contenders = List(8) { Thread { gate.await(); if (tickets.remove(id) != null) consumed.incrementAndGet() } }
    contenders.forEach { it.start() }
    gate.countDown()
    contenders.forEach { it.join() }
    assertEquals(1, consumed.get())
  }

  @Test fun activityClearAndModuleCloseRevokeAllOutstandingTickets() {
    val tickets = PaliPasskeyTickets<Any>()
    val first = tickets.prepare { Any() }
    tickets.clear()
    assertNull(tickets.remove(first))
    val second = tickets.prepare { Any() }
    tickets.clear(close = true)
    assertNull(tickets.remove(second))
    try { tickets.prepare { Any() }; fail("A destroyed module accepted a ticket") } catch (_: IllegalStateException) { }
    tickets.clear()
    try { tickets.prepare { Any() }; fail("Clearing reopened a destroyed module") } catch (_: IllegalStateException) { }
  }
}
