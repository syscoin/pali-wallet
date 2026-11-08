package org.syscoin.pali.prover

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.webkit.*
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedObject
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

private class ProofException : CodedException("privacy_proof_unavailable")

private fun readProofResource(stream: InputStream, limit: Int): ByteArray {
  val output = ByteArrayOutputStream()
  val chunk = ByteArray(8192)
  while (true) {
    val count = stream.read(chunk)
    if (count < 0) break
    check(output.size() + count <= limit)
    output.write(chunk, 0, count)
  }
  return output.toByteArray()
}

private object ProofAdmission {
  private var owner: PaliProofHost? = null
  private var poisoned = false
  private var foreground = true

  @Synchronized fun acquire(context: ReactContext): PaliProofHost {
    check(foreground && !poisoned && owner == null) { "privacy_proof_unavailable" }
    return PaliProofHost(context).also { owner = it }
  }

  @Synchronized fun release(host: PaliProofHost, clean: Boolean) {
    if (owner !== host) return
    poisoned = poisoned || !clean
    owner = null
  }

  fun background() {
    val current = synchronized(this) { foreground = false; owner }
    current?.close()
  }
  @Synchronized fun resume() { foreground = true }
}

private class ProofResources(private val context: Context, private val origin: String) {
  private var retired = false
  private var activeReads = 0
  private var drainRequested = false
  private var onDrained: (() -> Unit)? = null
  private val main = Handler(Looper.getMainLooper())
  private val assets: JSONObject

  init {
    val manifest = context.assets.open("pali-private-prover/proof-assets.json").use { readProofResource(it, 16384) }
    assets = JSONObject(String(manifest, Charsets.UTF_8))
    check(assets.length() in 1..16 && assets.has("index.html"))
  }

  fun response(request: WebResourceRequest): WebResourceResponse {
    synchronized(this) {
      if (retired || activeReads >= 8) return forbidden()
      activeReads += 1
    }
    return try {
      val url = request.url
      check(request.method == "GET" && url.scheme == "https" &&
        "https://${url.encodedAuthority}" == origin && url.query == null && url.fragment == null)
      val name = url.encodedPath?.removePrefix("/") ?: error("invalid")
      check(name.matches(Regex("[A-Za-z0-9_./-]+")) && !name.contains(".."))
      val pin = assets.getJSONObject(name)
      val size = pin.getInt("bytes")
      check(size in 1..16000000)
      val bytes = context.assets.open("pali-private-prover/$name").use { stream ->
        val result = readProofResource(stream, size)
        check(result.size == size)
        result
      }
      val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
      check(hash == pin.getString("sha256"))
      val workers = if (name == "index.html") "'self'" else "'none'"
      val csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src $workers; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
      WebResourceResponse(pin.getString("mime"), null, 200, "OK", mapOf(
        "Content-Security-Policy" to csp, "Content-Length" to bytes.size.toString(),
        "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"
      ), ByteArrayInputStream(bytes))
    } catch (_: Exception) {
      // Never return null: WebView's network loader must not handle a miss.
      forbidden()
    } finally {
      val callback = synchronized(this) {
        activeReads -= 1
        if (retired && activeReads == 0) onDrained.also { onDrained = null } else null
      }
      callback?.let { main.post { it() } }
    }
  }

  private fun forbidden() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))

  fun retire(callback: () -> Unit) {
    val complete = synchronized(this) {
      if (drainRequested) return
      drainRequested = true
      retired = true
      if (activeReads == 0) true else { onDrained = callback; false }
    }
    if (complete) main.post { callback() }
  }

  @Synchronized fun cancel() {
    retired = true
    onDrained = null
  }
}

class PaliProofHost internal constructor(private val context: ReactContext) : SharedObject() {
  private val main = Handler(Looper.getMainLooper())
  private val revoked = AtomicBoolean(false)
  private val started = AtomicBoolean(false)
  // All remaining mutable state is confined to the main looper.
  private var view: WebView? = null
  private var resources: ProofResources? = null
  // The peer endpoint belongs to JavaScript after postWebMessage transfers it.
  private var nativePort: WebMessagePort? = null
  private var id = ""
  private var origin = ""
  private var input: String? = null
  private var pending: Promise? = null
  private val disposals = mutableListOf<Promise>()
  private var submitted = false
  private var workerRetired = false
  private var retirementRequested = false
  private var retiring = false
  private var documentRetired = false
  private var readsDrained = false
  private var finished: Boolean? = null
  private var deadline: Runnable? = null

  fun run(job: String, json: String, promise: Promise) {
    val allowed = !revoked.get() && started.compareAndSet(false, true)
    main.post {
      if (!allowed || revoked.get() || context.lifecycleState != LifecycleState.RESUMED ||
          !job.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) || json.toByteArray().size > 8192) {
        promise.reject(ProofException()); close(); return@post
      }
      id = job; origin = "https://$id.pali-private-prover.invalid"; input = json; pending = promise
      try {
        openDocument()
        deadline = Runnable { fail() }.also { main.postDelayed(it, 120000) }
      } catch (_: Exception) { fail() }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun openDocument() {
    val reader = ProofResources(context, origin)
    resources = reader
    val document = WebView(context)
    view = document
    WebView.setWebContentsDebuggingEnabled(false)
    CookieManager.getInstance().setAcceptThirdPartyCookies(document, false)
    document.settings.apply {
      javaScriptEnabled = true
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      allowFileAccess = false
      allowContentAccess = false
      @Suppress("DEPRECATION") allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION") allowUniversalAccessFromFileURLs = false
      blockNetworkLoads = true
      blockNetworkImage = true
      domStorageEnabled = false
      databaseEnabled = false
      cacheMode = WebSettings.LOAD_NO_CACHE
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      mediaPlaybackRequiresUserGesture = true
      safeBrowsingEnabled = false
      setGeolocationEnabled(false)
    }
    document.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
      override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, false, false)
      }
      override fun onConsoleMessage(message: ConsoleMessage): Boolean = true
      override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
      override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean { result.cancel(); return true }
      override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String, result: JsPromptResult): Boolean { result.cancel(); return true }
    }
    document.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = reader.response(request)
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // The app initiates the only initial load. All page-initiated navigation is denied.
        if (retiring && request.isForMainFrame && request.url.toString() == "about:blank") return false
        fail(); return true
      }
      override fun onPageFinished(view: WebView, url: String) {
        if (retiring && url == "about:blank") {
          documentRetired = true; finishRetirement(); return
        }
        if (revoked.get() || url != "$origin/index.html" || nativePort != null) return
        var peer: WebMessagePort? = null
        try {
          val channel = view.createWebMessageChannel()
          nativePort = channel[0]
          peer = channel[1]
          channel[0].setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(port: WebMessagePort, message: WebMessage) {
              if (nativePort !== port || this@PaliProofHost.view !== view) return
              receive(message.data ?: "")
            }
          }, main)
          view.postWebMessage(WebMessage(id, arrayOf(channel[1])), Uri.parse(origin))
        } catch (_: Exception) {
          // A failed handshake may leave the peer untransferred.
          try { peer?.close() } catch (_: Exception) { /* Already transferred. */ }
          fail()
        }
      }
      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) { fail() }
      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) { fail() }
      override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) { handler.cancel(); fail() }
      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        pending?.reject(ProofException()); pending = null
        revoked.set(true); requestRetirement(contentProcessTerminated = true); return true
      }
    }
    document.loadUrl("$origin/index.html")
  }

  private fun receive(json: String) {
    try {
      check(finished == null && json.toByteArray().size <= 8192)
      val value = JSONObject(json)
      check(value.opt("version") is Int && value.getInt("version") == 1 && value.getString("id") == id)
      val type = value.getString("type")
      val keys = value.keys().asSequence().toSet()
      val basic = setOf("version", "id", "type")
      if (type == "disposed" && keys == basic && revoked.get()) {
        workerRetired = true; requestRetirement(); return
      }
      if (revoked.get()) return
      when {
        type == "ready" && keys == basic && !submitted -> {
          submitted = true
          val request = JSONObject().put("id", id).put("type", "start").put("input", checkNotNull(input))
          input = null
          checkNotNull(nativePort).postMessage(WebMessage(request.toString()))
        }
        type == "progress" && keys == basic + "progress" && submitted -> emit("progress", json)
        submitted && ((type == "success" && keys == basic + "result") || (type == "error" && keys == basic)) -> {
          workerRetired = true; deadline?.let { main.removeCallbacks(it) }
          pending?.resolve(json); pending = null
        }
        else -> fail()
      }
    } catch (_: Exception) { fail() }
  }

  fun close() {
    revoked.set(true)
    main.post { requestRetirement() }
  }

  fun dispose(promise: Promise) {
    close()
    main.post {
      when (finished) {
        true -> promise.resolve(null)
        false -> promise.reject(ProofException())
        null -> disposals.add(promise)
      }
    }
  }

  private fun fail() {
    pending?.reject(ProofException()); pending = null; input = null
    close()
  }

  private fun requestRetirement(contentProcessTerminated: Boolean = false) {
    if (finished != null) return
    if (retiring) {
      if (contentProcessTerminated) documentRetired = true
      finishRetirement(); return
    }
    pending?.reject(ProofException()); pending = null; input = null
    val document = view
    if (document == null) { finish(true); return }
    if (!retirementRequested) {
      retirementRequested = true
      deadline?.let { main.removeCallbacks(it) }
      deadline = Runnable { finish(false) }.also { main.postDelayed(it, 3000) }
    }
    try {
      if (contentProcessTerminated || !submitted || workerRetired) {
        retiring = true
        documentRetired = contentProcessTerminated
        resources?.retire {
          readsDrained = true
          finishRetirement()
        }
        nativePort?.close(); nativePort = null
        if (!contentProcessTerminated) {
          document.stopLoading(); document.loadUrl("about:blank")
        }
        finishRetirement()
      } else {
        checkNotNull(nativePort).postMessage(WebMessage(JSONObject().put("id", id).put("type", "cancel").toString()))
      }
    } catch (_: Exception) { finish(false) }
  }

  private fun finishRetirement() {
    if (documentRetired && readsDrained) finish(true)
  }

  private fun finish(clean: Boolean) {
    if (finished != null) return
    finished = clean
    deadline?.let { main.removeCallbacks(it) }; deadline = null
    pending?.reject(ProofException()); pending = null; input = null
    resources?.cancel(); resources = null
    var retired = clean
    try { nativePort?.close() } catch (_: Exception) { retired = false }; nativePort = null
    try { view?.stopLoading(); view?.removeAllViews(); view?.destroy() } catch (_: Exception) { retired = false }
    view = null
    finished = retired
    ProofAdmission.release(this, retired)
    disposals.forEach { if (retired) it.resolve(null) else it.reject(ProofException()) }
    disposals.clear()
  }

  override fun sharedObjectDidRelease() { close() }
}

class PaliPrivateProverModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaliPrivateProver")
    Function("createHost") {
      try {
        check(Build.VERSION.SDK_INT >= 26)
        ProofAdmission.acquire(checkNotNull(appContext.reactContext as? ReactContext))
      }
      catch (_: Exception) { throw ProofException() }
    }
    OnActivityEntersBackground { ProofAdmission.background() }
    OnActivityEntersForeground { ProofAdmission.resume() }
    OnDestroy { ProofAdmission.background() }
    Class("Host", PaliProofHost::class) {
      Events("progress")
      Function("close") { host: PaliProofHost -> host.close() }
      AsyncFunction("run") { host: PaliProofHost, id: String, input: String, promise: Promise -> host.run(id, input, promise) }
      AsyncFunction("dispose") { host: PaliProofHost, promise: Promise -> host.dispose(promise) }
    }
  }
}
