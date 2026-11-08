package org.syscoin.pali.websocket

import com.facebook.react.modules.network.ForwardingCookieHandler
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.decodeBase64

private const val MAX_FRAME_BYTES = 2 * 1024 * 1024
private class SocketException : CodedException("NATIVE_WEBSOCKET_UNAVAILABLE")

class PaliWalletConnectSocketModule : Module() {
  private val registry = SocketRegistry()
  private val cookies = ForwardingCookieHandler()
  private val client by lazy {
    OkHttpClientProvider.getOkHttpClient().newBuilder()
      .cookieJar(CookieJar.NO_COOKIES)
      .connectTimeout(10, TimeUnit.SECONDS)
      .writeTimeout(10, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .build()
  }

  private fun emit(id: String, type: String, values: Map<String, Any> = emptyMap()) {
    sendEvent("socketEvent", values + mapOf("id" to id, "type" to type))
  }

  override fun definition() = ModuleDefinition {
    Name("PaliWalletConnectSocket")
    Events("socketEvent")
    Function("createId") { UUID.randomUUID().toString() }
    Function("connect") { id: String, url: String, protocols: List<String>, headers: Map<String, String> ->
      if (!id.matches(Regex("[0-9a-f-]{36}")) || url.length > 8192 || protocols.size > 16 ||
        protocols.distinct().size != protocols.size || headers.size > 32) throw SocketException()
      val uri = try { URI(url) } catch (_: Exception) { throw SocketException() }
      if (uri.scheme !in listOf("ws", "wss") || uri.host.isNullOrEmpty() || uri.userInfo != null || uri.fragment != null) throw SocketException()
      if (protocols.any { it.length > 256 || !it.matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) }) throw SocketException()
      if (headers.any { (key, value) -> key.length > 256 || value.length > 8192 ||
        !key.matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) || value.contains('\r') || value.contains('\n') }) throw SocketException()
      if (headers.entries.sumOf { it.key.length + it.value.length } > 65536) throw SocketException()
      val connection = registry.create(id)
      try {
        val builder = Request.Builder().url(url)
        headers.forEach { (key, value) -> builder.addHeader(key, value) }
        val scheme = if (uri.scheme == "wss") "https" else "http"
        if (headers.keys.none { it.equals("origin", true) }) {
          builder.addHeader("origin", URI(scheme, null, uri.host, uri.port, null, null, null).toString())
        }
        if (headers.keys.none { it.equals("cookie", true) }) {
          val cookieUri = URI(scheme, null, uri.host, uri.port, uri.path, uri.query, null)
          cookies.get(cookieUri, emptyMap())["Cookie"]?.firstOrNull()?.let {
            builder.addHeader("Cookie", it)
          }
        }
        if (protocols.isNotEmpty()) builder.header("Sec-WebSocket-Protocol", protocols.joinToString(","))
        val socket = client.newWebSocket(builder.build(), object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) {
            val protocol = response.header("Sec-WebSocket-Protocol") ?: ""
            if (protocol.length > 256 || (protocol.isNotEmpty() && protocol !in protocols)) {
              registry.close(id, 1002, "Invalid protocol")
              return
            }
            if (registry.opened(connection, webSocket)) emit(id, "open", mapOf("protocol" to protocol))
          }
          override fun onMessage(webSocket: WebSocket, text: String) {
            if (!registry.readable(connection, webSocket)) return
            if (text.length > MAX_FRAME_BYTES || text.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) {
              registry.close(id, 1009, "Message too large")
            } else emit(id, "text", mapOf("data" to text))
          }
          override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (!registry.readable(connection, webSocket)) return
            if (bytes.size > MAX_FRAME_BYTES) registry.close(id, 1009, "Message too large")
            else emit(id, "binary", mapOf("data" to bytes.base64()))
          }
          override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            if (registry.readable(connection, webSocket)) registry.close(id, code, reason)
          }
          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (registry.finish(connection, webSocket)) emit(id, "close", mapOf("code" to code, "reason" to reason))
          }
          override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
            if (registry.finish(connection, webSocket)) emit(id, "error")
          }
        })
        registry.attach(connection, socket)
      } catch (_: Exception) {
        if (registry.finish(connection, null)) emit(id, "error")
      }
    }
    Function("send") { id: String, value: String, binary: Boolean ->
      val socket = registry.openSocket(id) ?: return@Function false
      if (binary) {
        if (value.length > ((MAX_FRAME_BYTES + 2) / 3) * 4) throw SocketException()
        val bytes = value.decodeBase64() ?: throw SocketException()
        if (bytes.size > MAX_FRAME_BYTES) throw SocketException()
        socket.send(bytes)
      } else {
        if (value.length > MAX_FRAME_BYTES || value.toByteArray(Charsets.UTF_8).size > MAX_FRAME_BYTES) throw SocketException()
        socket.send(value)
      }
    }
    Function("bufferedAmount") { id: String -> registry.openSocket(id)?.queueSize()?.toDouble() ?: 0.0 }
    Function("close") { id: String, code: Int, reason: String ->
      if ((code != 1000 && code !in 3000..4999) || reason.toByteArray(Charsets.UTF_8).size > 123) throw SocketException()
      registry.close(id, code, reason)
    }
    OnDestroy { registry.invalidate() }
  }
}
