package org.syscoin.pali.passkeys

import android.app.Activity
import android.content.Context
import android.content.MutableContextWrapper
import android.content.pm.PackageManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor

/** Native WebAuthn transport only; no wallet state or software key access. */
class PaliPasskeysModule : Module() {
  private class Ticket(val id: String, val activity: Activity, val origin: String)
  private class Ceremony(val ticket: Ticket, val promise: Promise) {
    val cancellation = CancellationSignal()
    val context = MutableContextWrapper(ticket.activity)
    var result: String? = null
    var timeout: Runnable? = null
  }

  private val lock = Any()
  private val main = Handler(Looper.getMainLooper())
  private val executor = Executor { task -> if (Looper.myLooper() == Looper.getMainLooper()) task.run() else main.post(task) }
  private val prepared = PaliPasskeyTickets<Ticket>()
  private var active: Ceremony? = null
  @Volatile private var destroyed = false

  private fun context(): Context {
    if (Build.VERSION.SDK_INT < 28 || destroyed || !appContext.hasActiveReactInstance) throw IllegalStateException("PASSKEY_UNAVAILABLE")
    return appContext.reactContext?.applicationContext ?: throw IllegalStateException("PASSKEY_UNAVAILABLE")
  }

  @Suppress("DEPRECATION")
  private fun origin(): String {
    val context = context()
    val signing = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
      ?: throw IllegalStateException("PASSKEY_UNAVAILABLE")
    if (signing.hasMultipleSigners()) throw IllegalStateException("PASSKEY_UNAVAILABLE")
    val signers = signing.apkContentsSigners ?: throw IllegalStateException("PASSKEY_UNAVAILABLE")
    return PaliPasskeyPolicy.origin(signers.map { it.toByteArray() })
  }

  private fun sameActivity(ticket: Ticket): Boolean = try {
    val context = context()
    appContext.currentActivity === ticket.activity && !ticket.activity.isFinishing && !ticket.activity.isDestroyed &&
      ticket.activity.applicationContext === context && origin() == ticket.origin
  } catch (_: Exception) { false }

  private fun resumedActivity(): Activity {
    val context = context()
    val activity = appContext.currentActivity
    if ((appContext.reactContext as? ReactContext)?.lifecycleState != LifecycleState.RESUMED || activity == null ||
      activity.isFinishing || activity.isDestroyed || activity.applicationContext !== context) throw IllegalStateException("PASSKEY_NOT_FOREGROUND")
    return activity
  }

  private fun owns(ceremony: Ceremony): Boolean = synchronized(lock) { !destroyed && active === ceremony }

  private fun finish(ceremony: Ceremony, result: String? = null, error: String? = null) {
    val owned = synchronized(lock) { if (active !== ceremony) false else { active = null; true } }
    if (!owned) return
    ceremony.cancellation.cancel()
    executor.execute {
      ceremony.timeout?.let(main::removeCallbacks)
      ceremony.result = null
      ceremony.context.baseContext = appContext.reactContext?.applicationContext ?: ceremony.ticket.activity.applicationContext
      if (error != null) ceremony.promise.reject(error, "Passkey operation unavailable", null)
      else ceremony.promise.resolve(result)
    }
  }

  private fun deliver(ceremony: Ceremony) {
    if (!owns(ceremony)) return
    if (!sameActivity(ceremony.ticket)) { finish(ceremony, error = "PASSKEY_CANCELLED"); return }
    if ((appContext.reactContext as? ReactContext)?.lifecycleState != LifecycleState.RESUMED) return
    ceremony.result?.let { finish(ceremony, result = it) }
  }

  private fun received(ceremony: Ceremony, raw: String) {
    if (!owns(ceremony)) return
    try { ceremony.result = PaliPasskeyPolicy.response(raw); deliver(ceremony) }
    catch (_: Exception) { finish(ceremony, error = "PASSKEY_INVALID_RESPONSE") }
  }

  private fun begin(id: String, options: String, create: Boolean, promise: Promise) {
    var ceremony: Ceremony? = null
    try {
      ceremony = synchronized(lock) {
        val ticket = prepared.remove(id) ?: throw IllegalStateException("PASSKEY_CANCELLED")
        if (destroyed || active != null) throw IllegalStateException("PASSKEY_BUSY")
        val activity = resumedActivity()
        if (ticket.activity !== activity || !sameActivity(ticket)) throw IllegalStateException("PASSKEY_CANCELLED")
        Ceremony(ticket, promise).also { active = it }
      }
      val owned = ceremony
      val admitted = if (create) PaliPasskeyPolicy.createOptions(options) else PaliPasskeyPolicy.getOptions(options)
      owned.timeout = Runnable { finish(owned, error = "PASSKEY_CANCELLED") }.also { main.postDelayed(it, PaliPasskeyPolicy.TIMEOUT_MS) }
      val manager = CredentialManager.create(context())
      if (!owns(owned) || owned.cancellation.isCanceled) return
      if (create) {
        val request = CreatePublicKeyCredentialRequest(requestJson = admitted, clientDataHash = null, origin = null,
          preferImmediatelyAvailableCredentials = false, isAutoSelectAllowed = false, isConditional = false)
        manager.createCredentialAsync(owned.context, request, owned.cancellation, executor,
          object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
            override fun onResult(result: CreateCredentialResponse) {
              if (result is CreatePublicKeyCredentialResponse) received(owned, result.registrationResponseJson)
              else finish(owned, error = "PASSKEY_INVALID_RESPONSE")
            }
            override fun onError(error: CreateCredentialException) {
              finish(owned, error = if (error is CreateCredentialCancellationException) "PASSKEY_CANCELLED" else "PASSKEY_FAILED")
            }
          })
      } else {
        val request = GetCredentialRequest(credentialOptions = listOf(GetPublicKeyCredentialOption(requestJson = admitted, clientDataHash = null)), origin = null)
        manager.getCredentialAsync(owned.context, request, owned.cancellation, executor,
          object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
            override fun onResult(result: GetCredentialResponse) {
              val credential = result.credential
              if (credential is PublicKeyCredential) received(owned, credential.authenticationResponseJson)
              else finish(owned, error = "PASSKEY_INVALID_RESPONSE")
            }
            override fun onError(error: GetCredentialException) {
              finish(owned, error = when (error) {
                is GetCredentialCancellationException -> "PASSKEY_CANCELLED"
                is NoCredentialException -> "PASSKEY_NOT_FOUND"
                else -> "PASSKEY_FAILED"
              })
            }
          })
      }
    } catch (error: Exception) {
      if (ceremony != null) finish(ceremony, error = if (error is IllegalArgumentException || error is org.json.JSONException) "PASSKEY_INVALID_REQUEST" else "PASSKEY_FAILED")
      else promise.reject(if (error.message in setOf("PASSKEY_BUSY", "PASSKEY_CANCELLED", "PASSKEY_NOT_FOREGROUND", "PASSKEY_UNAVAILABLE")) error.message!! else "PASSKEY_INVALID_REQUEST", "Passkey operation unavailable", null)
    }
  }

  private fun cancel(id: String): Boolean {
    val reserved = synchronized(lock) { prepared.remove(id) != null }
    val ceremony = synchronized(lock) { active?.takeIf { it.ticket.id == id } }
    if (ceremony != null) finish(ceremony, error = "PASSKEY_CANCELLED")
    return reserved || ceremony != null
  }

  private fun clear() {
    val ceremony = synchronized(lock) { prepared.clear(close = destroyed); active }
    if (ceremony != null) finish(ceremony, error = "PASSKEY_CANCELLED")
  }

  override fun definition() = ModuleDefinition {
    Name("PaliPasskeys")
    Function("getContext") { mapOf("rpId" to PaliPasskeyPolicy.RP_ID, "origin" to origin()) }
    Function("prepare") {
      val activity = resumedActivity()
      val origin = origin()
      synchronized(lock) {
        if (destroyed) throw IllegalStateException("PASSKEY_UNAVAILABLE")
        prepared.prepare { Ticket(it, activity, origin) }
      }
    }
    AsyncFunction("create") { id: String, options: String, promise: Promise -> begin(id, options, true, promise) }.runOnQueue(Queues.MAIN)
    AsyncFunction("get") { id: String, options: String, promise: Promise -> begin(id, options, false, promise) }.runOnQueue(Queues.MAIN)
    Function("cancel") { id: String -> cancel(id) }
    OnActivityEntersForeground { synchronized(lock) { active }?.let { executor.execute { deliver(it) } } }
    OnActivityDestroys { clear() }
    OnDestroy { destroyed = true; clear() }
  }
}
