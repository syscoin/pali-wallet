package org.syscoin.pali.storage

import java.io.IOException
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
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

internal class PaliPublicSnapshotResponse(val status: Int, private val storage: ByteArray) {
  /** Read-only, exact-capacity view of the single bounded allocation. */
  fun payload(): ByteBuffer = ByteBuffer.wrap(storage).asReadOnlyBuffer()
}

internal fun interface PaliPublicSnapshotCancellation {
  fun cancel()
}

/** Internal transport only. The shared engine still parses and verifies every result. */
internal object PaliPublicSnapshotDownloader {
  private const val SNAPSHOT_BYTES = 2 * 1024 * 1024
  private const val PROGRESS_BYTES = 4 * 1024
  private const val READ_BYTES = 16 * 1024
  private const val TIMEOUT_SECONDS = 25L
  private val lock = Any()
  private var active: Operation? = null

  private class DispatchPermit(val deadline: Long) {
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
          admittedLength(response)
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

  fun download(
    pool: String,
    completion: (Result<PaliPublicSnapshotResponse>) -> Unit
  ): PaliPublicSnapshotCancellation = start(
    endpoint(pool) ?: fail(PaliPublicSnapshotError.INVALID), TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS), completion
  )

  private fun start(
    endpoint: HttpUrl,
    timeoutNanos: Long,
    completion: (Result<PaliPublicSnapshotResponse>) -> Unit,
    observer: EventListener? = null
  ): PaliPublicSnapshotCancellation {
    val deadline = System.nanoTime() + timeoutNanos
    val operation = synchronized(lock) {
      if (active != null) fail(PaliPublicSnapshotError.BUSY)
      if (expired(deadline)) fail(PaliPublicSnapshotError.TIMEOUT)
      val request = Request.Builder().url(endpoint).get()
        .header("Accept-Encoding", "identity")
        .header("Accept", "application/json")
        .header("Cache-Control", "no-store, no-cache")
        .header("Pragma", "no-cache")
        .header("User-Agent", "PaliWallet")
        .tag(DispatchPermit::class.java, DispatchPermit(deadline))
        .build()
      val transport = observer?.let { client.newBuilder().eventListener(it).build() } ?: client
      val call = transport.newCall(request)
      call.timeout().deadlineNanoTime(deadline)
      Operation(call, deadline, completion).also { active = it }
    }
    operation.enqueue()
    return operation
  }

  private fun admittedLength(response: Response): Int {
    val limit = when (response.code) {
      200 -> SNAPSHOT_BYTES
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

  private class Operation(
    private val request: Call,
    private val deadline: Long,
    private val completion: (Result<PaliPublicSnapshotResponse>) -> Unit
  ) : Callback, PaliPublicSnapshotCancellation {
    private val state = Any()
    private var cancelled = false
    private var finished = false

    fun enqueue() {
      if (expired(deadline)) {
        finish(Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.TIMEOUT)))
        return
      }
      try {
        request.enqueue(this)
      } catch (_: RuntimeException) {
        request.cancel()
        finish(Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.UNAVAILABLE)))
      }
    }

    override fun cancel() {
      synchronized(state) {
        if (finished || cancelled) return
        cancelled = true
      }
      request.cancel()
    }

    private fun checkCurrent() {
      synchronized(state) {
        if (cancelled) fail(PaliPublicSnapshotError.CANCELLED)
        if (expired(deadline)) fail(PaliPublicSnapshotError.TIMEOUT)
      }
    }

    override fun onFailure(call: Call, e: IOException) {
      finish(Result.failure(transportFailure(e)))
    }

    override fun onResponse(call: Call, response: Response) {
      val result = try {
        Result.success(response.use { owned ->
          try {
            read(owned)
          } catch (error: Exception) {
            // Cancel before close so a refused body is not drained for connection reuse.
            call.cancel()
            throw error
          }
        })
      } catch (error: IOException) {
        Result.failure(transportFailure(error))
      } catch (_: RuntimeException) {
        Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.UNAVAILABLE))
      }
      finish(result)
    }

    private fun transportFailure(error: IOException): PaliPublicSnapshotException = when (error) {
      is PaliPublicSnapshotException -> error
      is SocketTimeoutException -> PaliPublicSnapshotException(PaliPublicSnapshotError.TIMEOUT)
      else -> PaliPublicSnapshotException(PaliPublicSnapshotError.UNAVAILABLE)
    }

    private fun read(response: Response): PaliPublicSnapshotResponse {
      checkCurrent()
      if (response.request.url != request.request().url) fail(PaliPublicSnapshotError.UNAVAILABLE)
      val declared = admittedLength(response)
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
      return PaliPublicSnapshotResponse(response.code, bytes)
    }

    private fun finish(result: Result<PaliPublicSnapshotResponse>) {
      val accepted = synchronized(state) {
        if (finished) return
        finished = true
        when {
          cancelled -> Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.CANCELLED))
          expired(deadline) -> Result.failure(PaliPublicSnapshotException(PaliPublicSnapshotError.TIMEOUT))
          else -> result
        }
      }
      synchronized(lock) {
        if (active !== this) return
        active = null
      }
      // Body closure precedes slot release and delivery. The old handle stays permanently retired.
      completion(accepted)
    }
  }
}
