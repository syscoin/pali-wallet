package org.syscoin.pali.storage

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.OutputStream
import java.lang.reflect.InvocationTargetException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private const val SNAPSHOT_BYTES = 2 * 1024 * 1024
private const val FIXTURE_TIMEOUT_MS = 5000L

class PaliPublicSnapshotDownloadTest {
  @Test
  fun boundedOwnedDownloadOverRealOkHttp() {
    for (pool in listOf("eth-0.1", "eth-1", "eth-10", "eth-100")) {
      assertEquals("https://sysnode.info/api/privacy/v1/pools/$pool/snapshot", PaliPublicSnapshotDownloader.endpoint(pool).toString())
    }
    for (pool in listOf("", "eth-0.10", "../eth-1", "eth-1?x=y", "ETH-1")) {
      expectThrow(PaliPublicSnapshotError.INVALID) {
        PaliPublicSnapshotDownloader.download(pool) { error("invalid pool dispatched") }
      }
    }
    SnapshotLoopback().use { server ->
      expectThrow(PaliPublicSnapshotError.TIMEOUT) { begin(server, "/must-not-hit", 0) }
      checkBody(run(server, "/exact").getOrThrow(), 200, SNAPSHOT_BYTES, 'a')
      checkBody(run(server, "/progress").getOrThrow(), 202, 4096, 'b')
      checkBody(run(server, "/short-fixed").getOrThrow(), 200, 5, 'a')
      assertTrue(server.bodyStarted.containsAll(listOf("/exact", "/progress", "/short-fixed")))
      for (path in server.refusedFraming.keys) expectFailure(server, path, PaliPublicSnapshotError.INVALID)
      assertTrue("Rejected framing must close while the server withholds the body",
        server.framingFinished.await(FIXTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS))
      assertEquals(server.refusedFraming.keys, server.framingClosed.toSet())
      assertTrue("No rejected framing may enter the body source",
        server.refusedFraming.keys.none(server.bodyStarted::contains))
      expectFailure(server, "/oversize-length", PaliPublicSnapshotError.TOO_LARGE)
      expectFailure(server, "/oversize-progress", PaliPublicSnapshotError.TOO_LARGE)
      expectFailure(server, "/encoded", PaliPublicSnapshotError.INVALID)
      expectFailure(server, "/duplicate-encoding", PaliPublicSnapshotError.INVALID)
      expectFailure(server, "/duplicate-length", PaliPublicSnapshotError.INVALID)
      expectFailure(server, "/redirect", PaliPublicSnapshotError.UNAVAILABLE)
      expectFailure(server, "/retry", PaliPublicSnapshotError.UNAVAILABLE)
      expectFailure(server, "/challenge", PaliPublicSnapshotError.UNAVAILABLE)
      expectFailure(server, "/partial", PaliPublicSnapshotError.UNAVAILABLE)
      expectFailure(server, "/truncated", PaliPublicSnapshotError.UNAVAILABLE)

      val (handle, pending) = begin(server, "/held")
      assertTrue(server.heldBody.await(FIXTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS))
      expectThrow(PaliPublicSnapshotError.BUSY) { begin(server, "/must-not-hit") }
      handle.cancel()
      handle.cancel()
      assertEquals(PaliPublicSnapshotError.CANCELLED, errorCode(pending.get(FIXTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS)))
      checkBody(run(server, "/reopened").getOrThrow(), 200, 5, 'a')
      val (_, deadline) = begin(server, "/deadline", 1500)
      assertTrue(server.deadlineBody.await(FIXTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS))
      handle.cancel()
      assertEquals(PaliPublicSnapshotError.TIMEOUT, errorCode(deadline.get(FIXTURE_TIMEOUT_MS, TimeUnit.MILLISECONDS)))
      checkBody(run(server, "/after-deadline").getOrThrow(), 200, 5, 'a')

      assertEquals(emptyList<String>(), server.violations.toList())
      assertEquals(server.paths.associateWith { 1 }, server.requests.toMap())
    }
  }

  private fun checkBody(response: PaliPublicSnapshotResponse, status: Int, length: Int, value: Char) {
    assertEquals(status, response.status)
    val bytes = response.payload()
    assertTrue(bytes.isReadOnly)
    assertEquals(length, bytes.capacity())
    while (bytes.hasRemaining()) check(bytes.get() == value.code.toByte())
  }

  private fun expectThrow(expected: PaliPublicSnapshotError, action: () -> Unit) {
    try {
      action()
      error("expected $expected")
    } catch (error: PaliPublicSnapshotException) {
      assertEquals(expected, error.error)
    }
  }

  private fun errorCode(result: Result<PaliPublicSnapshotResponse>): PaliPublicSnapshotError =
    (result.exceptionOrNull() as PaliPublicSnapshotException).error

  private fun expectFailure(server: SnapshotLoopback, path: String, expected: PaliPublicSnapshotError) {
    assertEquals(path, expected, errorCode(run(server, path)))
  }

  private fun run(server: SnapshotLoopback, path: String, timeoutMs: Long = FIXTURE_TIMEOUT_MS) =
    begin(server, path, timeoutMs).second.get(FIXTURE_TIMEOUT_MS + 1000, TimeUnit.MILLISECONDS)

  // Only tests substitute a loopback URL. The producer's production entry accepts a registered pool ID.
  private fun begin(server: SnapshotLoopback, path: String, timeoutMs: Long = FIXTURE_TIMEOUT_MS):
    Pair<PaliPublicSnapshotCancellation, CompletableFuture<Result<PaliPublicSnapshotResponse>>> {
    val method = PaliPublicSnapshotDownloader::class.java.getDeclaredMethod(
      "start", HttpUrl::class.java, java.lang.Long.TYPE, Function1::class.java, EventListener::class.java
    ).apply { isAccessible = true }
    val pending = CompletableFuture<Result<PaliPublicSnapshotResponse>>()
    val complete: (Result<PaliPublicSnapshotResponse>) -> Unit = { check(pending.complete(it)) }
    val observer = object : EventListener() {
      override fun responseBodyStart(call: Call) {
        server.bodyStarted.add(path)
      }
    }
    val handle = try {
      method.invoke(PaliPublicSnapshotDownloader, server.url(path), TimeUnit.MILLISECONDS.toNanos(timeoutMs), complete, observer)
    } catch (error: InvocationTargetException) {
      throw error.targetException
    }
    return (handle as PaliPublicSnapshotCancellation) to pending
  }
}

private class SnapshotLoopback : Closeable {
  private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
  private val workers = Executors.newCachedThreadPool()
  val requests = ConcurrentHashMap<String, Int>()
  val violations = CopyOnWriteArrayList<String>()
  val heldBody = CountDownLatch(1)
  val deadlineBody = CountDownLatch(1)
  val bodyStarted = ConcurrentHashMap.newKeySet<String>()
  val refusedFraming = linkedMapOf(
    "/chunked" to arrayOf("Transfer-Encoding: chunked"),
    "/ambiguous-framing" to arrayOf("Content-Length: 5", "Transfer-Encoding: chunked"),
    "/missing-length" to emptyArray<String>(),
    "/transfer-identity" to arrayOf("Content-Length: 5", "Transfer-Encoding: identity")
  )
  val framingClosed = ConcurrentHashMap.newKeySet<String>()
  val framingFinished = CountDownLatch(refusedFraming.size)
  val paths = setOf(
    "/exact", "/progress", "/short-fixed", "/oversize-length", "/oversize-progress",
    "/encoded", "/duplicate-encoding", "/duplicate-length", "/redirect", "/retry", "/challenge", "/partial",
    "/truncated", "/held", "/reopened", "/deadline", "/after-deadline"
  ) + refusedFraming.keys
  private val acceptor = Thread {
    try {
      while (!server.isClosed) {
        val socket = server.accept()
        workers.execute { socket.use { serve(it) } }
      }
    } catch (error: IOException) {
      if (!server.isClosed) violations.add("accept failed: $error")
    }
  }.apply { start() }

  fun url(path: String): HttpUrl = "http://127.0.0.1:${server.localPort}$path".toHttpUrl()

  private fun serve(socket: Socket) {
    socket.soTimeout = 1000
    try {
      val input = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
      val line = input.readLine() ?: return
      val parts = line.split(' ')
      val path = parts.getOrNull(1).orEmpty()
      requests.merge(path, 1) { total, next -> total + next }
      val headers = mutableMapOf<String, String>()
      while (true) {
        val header = input.readLine() ?: break
        if (header.isEmpty()) break
        headers[header.substringBefore(':').lowercase()] = header.substringAfter(':').trim()
      }
      val output = socket.getOutputStream()
      if (parts.firstOrNull() != "GET" || parts.getOrNull(2) != "HTTP/1.1" || path !in paths ||
        headers["accept-encoding"] != "identity" ||
        headers["user-agent"] != "PaliWallet" || headers["cache-control"] != "no-store, no-cache" ||
        listOf("cookie", "authorization", "referer", "proxy-authorization").any(headers::containsKey)
      ) {
        violations.add("Unexpected request policy for $path")
        output.headers(400, "Content-Length: 0")
        return
      }
      refusedFraming[path]?.let { framing ->
        try {
          output.headers(200, *framing)
          socket.soTimeout = FIXTURE_TIMEOUT_MS.toInt()
          // Deliberately never send a body or chunk line. The peer has to close first.
          val disconnected = try { input.read() == -1 } catch (_: SocketException) { true }
          if (disconnected) framingClosed.add(path)
        } finally {
          framingFinished.countDown()
        }
        return
      }
      when (path) {
        "/exact" -> output.body(200, ByteArray(SNAPSHOT_BYTES) { 'a'.code.toByte() }, "Set-Cookie: blocked=1")
        "/progress" -> output.body(202, ByteArray(4096) { 'b'.code.toByte() })
        "/oversize-length" -> output.headers(200, "Content-Length: ${SNAPSHOT_BYTES + 1}")
        "/oversize-progress" -> output.headers(202, "Content-Length: 4097")
        "/encoded" -> {
          val body = ByteArrayOutputStream().apply {
            GZIPOutputStream(this).use { it.write(ByteArray(SNAPSHOT_BYTES + 1)) }
          }.toByteArray()
          output.body(200, body, "Content-Encoding: gzip")
        }
        "/duplicate-encoding" -> output.body(200, ByteArray(1), "Content-Encoding: gzip", "Content-Encoding: identity")
        "/duplicate-length" -> output.body(200, ByteArray(1), "Content-Length: 1")
        "/redirect" -> output.headers(302, "Content-Length: 0", "Location: /must-not-hit")
        "/retry" -> output.headers(503, "Content-Length: 0", "Retry-After: 0")
        "/challenge" -> output.headers(401, "Content-Length: 0", "WWW-Authenticate: Basic realm=\"fixture\"")
        "/partial" -> output.headers(206, "Content-Length: 0")
        "/truncated" -> { output.headers(200, "Content-Length: 100"); output.write(1) }
        "/held", "/deadline" -> {
          output.headers(200, "Content-Length: 100")
          output.write(1)
          output.flush()
          if (path == "/held") heldBody.countDown() else deadlineBody.countDown()
          Thread.sleep(2500)
        }
        else -> output.body(200, ByteArray(5) { 'a'.code.toByte() })
      }
    } catch (_: IOException) {
      // The refusing client can close mid-write or before sending headers on a follow-up connection.
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  private fun OutputStream.headers(status: Int, vararg fields: String) {
    val lines = listOf("HTTP/1.1 $status Fixture", "Connection: close", "Content-Type: application/json") + fields
    write(lines.joinToString("\r\n", postfix = "\r\n\r\n").toByteArray(Charsets.US_ASCII))
    flush()
  }

  private fun OutputStream.body(status: Int, bytes: ByteArray, vararg fields: String) {
    headers(status, "Content-Length: ${bytes.size}", *fields)
    write(bytes)
  }


  override fun close() {
    server.close()
    acceptor.join(1000)
    workers.shutdownNow()
    workers.awaitTermination(1000, TimeUnit.MILLISECONDS)
  }
}
