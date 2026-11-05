package org.syscoin.pali.storage

import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response

internal enum class PaliPublicSnapshotError(val code: String) {
  BUSY("PUBLIC_SNAPSHOT_BUSY"),
  CANCELLED("PUBLIC_SNAPSHOT_CANCELLED"),
  TIMEOUT("PUBLIC_SNAPSHOT_TIMEOUT"),
  INVALID("PUBLIC_SNAPSHOT_INVALID"),
  TOO_LARGE("PUBLIC_SNAPSHOT_TOO_LARGE"),
  UNAVAILABLE("PUBLIC_SNAPSHOT_UNAVAILABLE")
}

internal class PaliPublicSnapshotException(val error: PaliPublicSnapshotError) : IOException(error.code)

internal data class PaliPublicSnapshotInfo(val status: Int, val byteCount: Int)

internal interface PaliPublicSnapshotOperation {
  fun start()
  fun info(): PaliPublicSnapshotInfo
  fun pull(): ByteArray?
  fun cancel()
}

/** Internal transport only. The shared engine still parses and verifies every result. */
internal object PaliPublicSnapshotDownloader {
  private const val SNAPSHOT_BYTES = 2 * 1024 * 1024
  private const val PROGRESS_BYTES = 4 * 1024
  private const val READ_BYTES = 16 * 1024
  private const val PULL_BYTES = 64 * 1024
  private const val TIMEOUT_SECONDS = 25L
  private const val MAX_PENDING_COMPLETIONS = 2
  private val lock = Any()
  private var active: Operation? = null
  private var pendingCompletions = 0
  private val deadlines by lazy {
    ScheduledThreadPoolExecutor(1) { work ->
      Thread(work, "PaliPublicSnapshotDeadline").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
  }
  private val completions by lazy {
    ThreadPoolExecutor(
      MAX_PENDING_COMPLETIONS, MAX_PENDING_COMPLETIONS, 30, TimeUnit.SECONDS,
      ArrayBlockingQueue(MAX_PENDING_COMPLETIONS)
    ) { work ->
      Thread(work, "PaliPublicSnapshotCompletion").apply { isDaemon = true }
    }.apply { allowCoreThreadTimeOut(true) }
  }

  private class DispatchPermit(val deadline: Long, val snapshotLimit: Int) {
    val used = AtomicBoolean(false)
  }

  private val client by lazy {
    OkHttpClient.Builder()
      // The HTTP/2 codec strips Transfer-Encoding before a response reaches this policy.
      .protocols(listOf(Protocol.HTTP_1_1))
      .cookieJar(CookieJar.NO_COOKIES)
      .authenticator(Authenticator.NONE)
      .proxyAuthenticator(Authenticator.NONE)
      .cache(null)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .callTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS))
      .addNetworkInterceptor { chain ->
        // OkHttp also handles status-based follow-ups, including 503 with Retry-After: 0.
        val request = chain.request()
        val permit = request.tag(DispatchPermit::class.java)
        if (permit == null || expired(permit.deadline) || chain.call().isCanceled() ||
          !permit.used.compareAndSet(false, true)
        ) throw IOException()
        val response = chain.proceed(request)
        try {
          admittedLength(response, permit.snapshotLimit)
          response
        } catch (error: PaliPublicSnapshotException) {
          // A body close can read chunk extensions while discarding. Throw after cancel so
          // OkHttp detaches this exchange without reading or discarding its rejected body.
          chain.call().cancel()
          throw error
        }
      }
      .build()
  }

  fun endpoint(pool: String): HttpUrl? = when (pool) {
    "eth-0.1", "eth-1", "eth-10", "eth-100" -> "https://sysnode.info/api/privacy/v1/pools/$pool/snapshot".toHttpUrl()
    else -> null
  }

  /** The caller receives the exact cancellation handle before starting any I/O. */
  fun prepare(
    pool: String,
    completion: (Result<Unit>) -> Unit
  ): PaliPublicSnapshotOperation = reserve(
    endpoint(pool) ?: fail(PaliPublicSnapshotError.INVALID),
    TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS), SNAPSHOT_BYTES, completion
  )

  private fun reserve(
    endpoint: HttpUrl,
    timeoutNanos: Long,
    snapshotLimit: Int,
    completion: (Result<Unit>) -> Unit,
    observer: EventListener? = null
  ): PaliPublicSnapshotOperation {
    val deadline = System.nanoTime() + timeoutNanos
    val operation = synchronized(lock) {
      if (active != null || pendingCompletions >= MAX_PENDING_COMPLETIONS) fail(PaliPublicSnapshotError.BUSY)
      if (expired(deadline)) fail(PaliPublicSnapshotError.TIMEOUT)
      val request = Request.Builder().url(endpoint).get()
        .header("Accept-Encoding", "identity")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-store, no-cache")
        .header("Pragma", "no-cache")
        .header("User-Agent", "PaliWallet")
        .tag(DispatchPermit::class.java, DispatchPermit(deadline, snapshotLimit))
        .build()
      val transport = observer?.let { client.newBuilder().eventListener(it).build() } ?: client
      val call = transport.newCall(request)
      call.timeout().deadlineNanoTime(deadline)
      Operation(call, deadline, snapshotLimit, completion).also {
        pendingCompletions++
        active = it
      }
    }
    operation.armDeadline()
    return operation
  }

  private fun admittedLength(response: Response, snapshotLimit: Int): Int {
    val limit = when (response.code) {
      200 -> snapshotLimit
      202 -> PROGRESS_BYTES
      else -> fail(PaliPublicSnapshotError.UNAVAILABLE)
    }
    if (response.headers("Transfer-Encoding").isNotEmpty()) fail(PaliPublicSnapshotError.INVALID)
    val encodings = response.headers("Content-Encoding")
    if (encodings.size > 1 || encodings.singleOrNull()?.equals("identity", ignoreCase = true) == false) {
      fail(PaliPublicSnapshotError.INVALID)
    }
    val header = response.headers("Content-Length").singleOrNull() ?: fail(PaliPublicSnapshotError.INVALID)
    if (header.isEmpty() || header.any { it !in '0'..'9' }) fail(PaliPublicSnapshotError.INVALID)
    return header.toIntOrNull()?.takeIf { it <= limit } ?: fail(PaliPublicSnapshotError.TOO_LARGE)
  }

  private fun expired(deadline: Long): Boolean = System.nanoTime() - deadline >= 0L
  private fun fail(error: PaliPublicSnapshotError): Nothing = throw PaliPublicSnapshotException(error)

  /** A delayed caller may occupy its reserved completion slot, never a transport or timer worker. */
  private fun deliverCompletion(completion: (Result<Unit>) -> Unit, result: Result<Unit>) {
    completions.submit {
      try {
        completion(result)
      } finally {
        synchronized(lock) { pendingCompletions-- }
      }
    }
  }

  private class Operation(
    private val request: Call,
    private val deadline: Long,
    private val snapshotLimit: Int,
    completion: (Result<Unit>) -> Unit
  ) : Callback, PaliPublicSnapshotOperation {
    private enum class Phase { RESERVED, DOWNLOADING, READY, RETIRED }

    private val state = Any()
    private var phase = Phase.RESERVED
    private var completion: ((Result<Unit>) -> Unit)? = completion
    private var timer: ScheduledFuture<*>? = null
    private var stopped: PaliPublicSnapshotError? = null
    private var info: PaliPublicSnapshotInfo? = null
    private var body: ByteArray? = null
    private var offset = 0

    fun armDeadline() = synchronized(state) {
      timer = deadlines.schedule(
        { stop(PaliPublicSnapshotError.TIMEOUT) }, deadline - System.nanoTime(), TimeUnit.NANOSECONDS
      )
    }

    override fun start() {
      synchronized(state) {
        if (phase != Phase.RESERVED || stopReasonLocked() != null) return
        phase = Phase.DOWNLOADING
      }
      try {
        request.enqueue(this)
      } catch (_: RuntimeException) {
        request.cancel()
        finish(PaliPublicSnapshotError.UNAVAILABLE)
      }
    }

    /** A completion is only a wakeup. Read metadata through the exact current handle. */
    override fun info(): PaliPublicSnapshotInfo = synchronized(state) {
      stopReasonLocked()?.let(::fail)
      info?.takeIf { phase == Phase.READY } ?: fail(PaliPublicSnapshotError.UNAVAILABLE)
    }

    /** A fixed-size copy on demand. Exact EOF retires the handle and frees the slot. */
    override fun pull(): ByteArray? {
      val chunk = synchronized(state) {
        stopReasonLocked()?.let(::fail)
        val bytes = body?.takeIf { phase == Phase.READY } ?: fail(PaliPublicSnapshotError.UNAVAILABLE)
        if (offset == bytes.size) {
          retireLocked(PaliPublicSnapshotError.CANCELLED)
          null
        } else {
          val end = minOf(offset + PULL_BYTES, bytes.size)
          val chunk = bytes.copyOfRange(offset, end)
          stopReasonLocked()?.let(::fail)
          offset = end
          chunk
        }
      }
      if (chunk == null) release()
      return chunk
    }

    override fun cancel() = stop(PaliPublicSnapshotError.CANCELLED)

    private fun retireLocked(error: PaliPublicSnapshotError) {
      stopped = error
      phase = Phase.RETIRED
      info = null
      body = null
      timer?.cancel(false)
      timer = null
    }

    private fun takeCompletionLocked() = completion.also { completion = null }

    private fun release() {
      synchronized(lock) {
        if (active === this) active = null
      }
    }

    private fun stop(error: PaliPublicSnapshotError) {
      val (notify, retired) = synchronized(state) {
        if (stopped != null) return
        if (phase == Phase.DOWNLOADING) {
          stopped = error
          null to false
        } else {
          retireLocked(error)
          takeCompletionLocked() to true
        }
      }
      if (retired) release()
      else request.cancel()
      notify?.let { deliverCompletion(it, Result.failure(PaliPublicSnapshotException(error))) }
    }

    private fun stopReasonLocked(): PaliPublicSnapshotError? =
      stopped ?: PaliPublicSnapshotError.TIMEOUT.takeIf { expired(deadline) }

    private fun checkCurrent() = synchronized(state) { stopReasonLocked()?.let(::fail) }

    override fun onFailure(call: Call, e: IOException) {
      finish(transportFailure(e))
    }

    override fun onResponse(call: Call, response: Response) {
      val error = try {
        readAndStage(call, response)
        null
      } catch (error: IOException) {
        transportFailure(error)
      } catch (_: RuntimeException) {
        PaliPublicSnapshotError.UNAVAILABLE
      }
      finish(error)
    }

    private fun readAndStage(call: Call, response: Response) {
      val bytes = response.use {
        try {
          read(it)
        } catch (error: Exception) {
          // Cancel before close so a refused body is not drained for connection reuse.
          call.cancel()
          throw error
        }
      }
      synchronized(state) {
        body = bytes
        info = PaliPublicSnapshotInfo(response.code, bytes.size)
      }
    }

    private fun transportFailure(error: IOException): PaliPublicSnapshotError = when (error) {
      is PaliPublicSnapshotException -> error.error
      is SocketTimeoutException -> PaliPublicSnapshotError.TIMEOUT
      else -> PaliPublicSnapshotError.UNAVAILABLE
    }

    private fun read(response: Response): ByteArray {
      checkCurrent()
      if (response.request.url != request.request().url) fail(PaliPublicSnapshotError.UNAVAILABLE)
      val declared = admittedLength(response, snapshotLimit)
      val stream = response.body?.byteStream() ?: fail(PaliPublicSnapshotError.INVALID)
      val bytes = ByteArray(declared)
      var length = 0
      while (length < bytes.size) {
        checkCurrent()
        val count = stream.read(bytes, length, minOf(READ_BYTES, bytes.size - length))
        if (count <= 0) fail(PaliPublicSnapshotError.INVALID)
        length += count
      }
      checkCurrent()
      if (stream.read() != -1) fail(PaliPublicSnapshotError.INVALID)
      checkCurrent()
      return bytes
    }

    private fun finish(error: PaliPublicSnapshotError?) {
      val (notify, refused) = synchronized(state) {
        if (phase != Phase.DOWNLOADING) return
        val reason = stopReasonLocked() ?: error
        if (reason != null) retireLocked(reason)
        else phase = Phase.READY
        takeCompletionLocked() to reason
      }
      if (refused != null) release()
      notify?.let {
        deliverCompletion(it, if (refused == null) Result.success(Unit) else Result.failure(PaliPublicSnapshotException(refused)))
      }
    }
  }
}
