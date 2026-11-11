package org.syscoin.pali.updates

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallException
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/** Play owns download/install state. This bridge never starts or completes from a callback. */
class PaliAppUpdatesModule : Module() {
  private class Ticket(val id: String, val activity: Activity) {
    var request: Request? = null
    var crossedBoundary = false
  }
  private class Request(val promise: Promise, val activity: Activity? = null, val ticket: Ticket? = null)

  private val main = Handler(Looper.getMainLooper())
  private val ticketLock = Any()
  private val tickets = mutableMapOf<String, Ticket>()
  private val pending = mutableSetOf<Request>()
  private var mutation: Request? = null
  private var manager: AppUpdateManager? = null
  @Volatile private var destroyed = false
  private var snapshot: Map<String, Any?> = emptyState()

  private val installListener = InstallStateUpdatedListener { state ->
    onMain {
      if (!destroyed) {
        snapshot = snapshot + mapOf(
          "storeAvailable" to true,
          "storeErrorCode" to null,
          "availability" to when (state.installStatus()) {
            InstallStatus.PENDING, InstallStatus.DOWNLOADING, InstallStatus.DOWNLOADED, InstallStatus.INSTALLING -> "in-progress"
            InstallStatus.INSTALLED -> "not-available"
            else -> snapshot["availability"]
          },
          "installStatus" to statusName(state.installStatus()),
          "bytesDownloaded" to state.bytesDownloaded().toDouble(),
          "totalBytesToDownload" to state.totalBytesToDownload().toDouble()
        )
        sendEvent("onUpdateState", snapshot)
      }
    }
  }

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() }
  }

  private fun emptyState(errorCode: Int? = null): Map<String, Any?> = mapOf(
    "supported" to true, "storeAvailable" to false, "storeErrorCode" to errorCode,
    "availability" to "unknown", "installedVersionCode" to null,
    "availableVersionCode" to null, "priority" to null, "stalenessDays" to null,
    "installStatus" to "unknown", "bytesDownloaded" to 0.0, "totalBytesToDownload" to 0.0,
    "flexibleAllowed" to false, "immediateAllowed" to false
  )

  private fun statusName(status: Int): String = when (status) {
    InstallStatus.PENDING -> "pending"
    InstallStatus.DOWNLOADING -> "downloading"
    InstallStatus.DOWNLOADED -> "downloaded"
    InstallStatus.INSTALLING -> "installing"
    InstallStatus.INSTALLED -> "installed"
    InstallStatus.FAILED -> "failed"
    InstallStatus.CANCELED -> "cancelled"
    else -> "unknown"
  }

  private fun context(): Context = appContext.reactContext?.applicationContext
    ?.takeIf { !destroyed && appContext.hasActiveReactInstance }
    ?: throw IllegalStateException("APP_UPDATE_UNAVAILABLE")

  private fun updateManager(): AppUpdateManager {
    manager?.let { return it }
    val created = AppUpdateManagerFactory.create(context())
    created.registerListener(installListener)
    manager = created
    return created
  }

  private fun foregroundActivity(): Activity {
    val context = context()
    val react = appContext.reactContext as? ReactContext
    val activity = appContext.currentActivity
    if (react?.lifecycleState != LifecycleState.RESUMED || activity == null ||
      activity.isFinishing || activity.isDestroyed || activity.applicationContext !== context)
      throw IllegalStateException("APP_UPDATE_NOT_FOREGROUND")
    return activity
  }

  private fun active(request: Request) = !destroyed && pending.contains(request) &&
    (request.ticket == null || synchronized(ticketLock) { tickets[request.ticket.id] === request.ticket })

  private fun forgetTicket(request: Request) {
    request.ticket?.let { ticket -> synchronized(ticketLock) {
      if (tickets[ticket.id] === ticket) tickets.remove(ticket.id)
    } }
  }

  private fun resolve(request: Request, value: Any?) {
    if (!pending.remove(request)) return
    forgetTicket(request)
    if (mutation === request) mutation = null
    request.promise.resolve(value)
  }

  private fun reject(request: Request, code: String) {
    if (!pending.remove(request)) return
    forgetTicket(request)
    if (mutation === request) mutation = null
    request.promise.reject(code, "App update action unavailable", null)
  }

  private fun begin(promise: Promise, token: String? = null): Request? {
    val mutating = token != null
    val ticket = token?.let { synchronized(ticketLock) { tickets[it]?.takeIf { item -> item.request == null } } }
    if (mutating && ticket == null) {
      promise.reject("APP_UPDATE_CANCELLED", "App update action cancelled", null)
      return null
    }
    if (destroyed || (mutating && mutation != null)) {
      ticket?.let { synchronized(ticketLock) { tickets.remove(it.id) } }
      promise.reject(if (destroyed) "APP_UPDATE_UNAVAILABLE" else "APP_UPDATE_BUSY", "App update action unavailable", null)
      return null
    }
    val activity = try { if (mutating) foregroundActivity().also {
      if (it !== ticket?.activity) throw IllegalStateException("APP_UPDATE_NOT_FOREGROUND")
    } else null }
    catch (_: Exception) {
      ticket?.let { synchronized(ticketLock) { tickets.remove(it.id) } }
      promise.reject("APP_UPDATE_NOT_FOREGROUND", "App update action unavailable", null)
      return null
    }
    val request = Request(promise, activity, ticket)
    if (ticket != null && !synchronized(ticketLock) {
      if (tickets[ticket.id] !== ticket) false else { ticket.request = request; true }
    }) {
      promise.reject("APP_UPDATE_CANCELLED", "App update action cancelled", null)
      return null
    }
    return request.also {
      pending.add(it)
      if (mutating) mutation = it
    }
  }

  /** Atomic with cancellation, including cancellation before the queued AsyncFunction begins. */
  private fun crossBoundary(request: Request, action: () -> Unit) {
    val ticket = request.ticket ?: throw IllegalStateException("APP_UPDATE_CANCELLED")
    synchronized(ticketLock) {
      if (destroyed || tickets[ticket.id] !== ticket) {
        reject(request, "APP_UPDATE_CANCELLED")
        return
      }
      ticket.crossedBoundary = true
      action()
    }
  }

  private fun cancelPending(token: String): Boolean {
    val request: Request?
    synchronized(ticketLock) {
      val ticket = tickets[token] ?: return false
      if (ticket.crossedBoundary) return false
      tickets.remove(token)
      request = ticket.request
    }
    request?.let { onMain { reject(it, "APP_UPDATE_CANCELLED") } }
    return true
  }

  private fun revokePreflights() {
    val requests = synchronized(ticketLock) {
      val revoked = tickets.values.filter { !it.crossedBoundary }
      revoked.forEach { tickets.remove(it.id) }
      revoked.mapNotNull { it.request }
    }
    onMain { requests.forEach { reject(it, "APP_UPDATE_NOT_FOREGROUND") } }
  }

  private fun assertCurrentActivity(request: Request) {
    if (foregroundActivity() !== request.activity) throw IllegalStateException("APP_UPDATE_NOT_FOREGROUND")
  }

  @Suppress("DEPRECATION")
  private fun readSnapshot(info: AppUpdateInfo): Map<String, Any?> {
    val context = context()
    if (info.packageName() != context.packageName) throw IllegalStateException("APP_UPDATE_UNAVAILABLE")
    val installed = context.packageManager.getPackageInfo(context.packageName, 0)
    val hasUpdate = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
      info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
    val downloading = hasUpdate && info.installStatus() == InstallStatus.DOWNLOADING
    return mapOf(
      "supported" to true, "storeAvailable" to true, "storeErrorCode" to null,
      "availability" to when (info.updateAvailability()) {
        UpdateAvailability.UPDATE_AVAILABLE -> "available"
        UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> "in-progress"
        UpdateAvailability.UPDATE_NOT_AVAILABLE -> "not-available"
        else -> "unknown"
      },
      "installedVersionCode" to (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) installed.longVersionCode else installed.versionCode.toLong()).toDouble(),
      "availableVersionCode" to if (hasUpdate) info.availableVersionCode() else null,
      "priority" to if (hasUpdate) info.updatePriority() else null,
      "stalenessDays" to if (hasUpdate) info.clientVersionStalenessDays() else null,
      "installStatus" to if (hasUpdate) statusName(info.installStatus()) else "unknown",
      "bytesDownloaded" to if (downloading) info.bytesDownloaded().toDouble() else 0.0,
      "totalBytesToDownload" to if (downloading) info.totalBytesToDownload().toDouble() else 0.0,
      "flexibleAllowed" to (hasUpdate && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)),
      "immediateAllowed" to (hasUpdate && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
    )
  }

  private fun publish(info: AppUpdateInfo) {
    snapshot = readSnapshot(info)
    sendEvent("onUpdateState", snapshot)
  }

  private fun query(request: Request, action: (AppUpdateManager, AppUpdateInfo) -> Unit) {
    try {
      val manager = updateManager()
      manager.appUpdateInfo.addOnSuccessListener { info ->
        if (active(request)) try {
          publish(info)
          action(manager, info)
        } catch (_: Exception) { reject(request, "APP_UPDATE_UNAVAILABLE") }
      }.addOnFailureListener { error ->
        if (active(request)) {
          snapshot = emptyState((error as? InstallException)?.errorCode)
          sendEvent("onUpdateState", snapshot)
          if (request.activity == null) resolve(request, snapshot)
          else reject(request, "APP_UPDATE_UNAVAILABLE")
        }
      }
    } catch (_: Exception) { reject(request, "APP_UPDATE_UNAVAILABLE") }
  }

  override fun definition() = ModuleDefinition {
    Name("PaliAppUpdates")
    Events("onUpdateState")
    Function("prepareUpdate") {
      synchronized(ticketLock) {
        if (destroyed || tickets.size >= 16) throw IllegalStateException("APP_UPDATE_UNAVAILABLE")
        // Only reads host state here; the main-queue action checks this same Activity again.
        val activity = foregroundActivity()
        val token = UUID.randomUUID().toString()
        tickets[token] = Ticket(token, activity)
        token
      }
    }
    Function("cancelPendingUpdate") { token: String -> cancelPending(token) }
    AsyncFunction("check") { promise: Promise ->
      begin(promise)?.let { request -> query(request) { _, _ -> resolve(request, snapshot) } }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("start") { token: String, mode: String, promise: Promise ->
      if (mode != "flexible" && mode != "immediate") {
        cancelPending(token)
        promise.reject("APP_UPDATE_INVALID_MODE", "Invalid app update mode", null)
      } else begin(promise, token)?.let { request ->
        query(request) { manager, info ->
          assertCurrentActivity(request)
          val type = if (mode == "immediate") AppUpdateType.IMMEDIATE else AppUpdateType.FLEXIBLE
          val options = AppUpdateOptions.newBuilder(type).build()
          val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
            info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if (!available || info.installStatus() == InstallStatus.DOWNLOADED || !info.isUpdateTypeAllowed(options)) {
            resolve(request, "unavailable")
          } else {
            // The Play dialog pauses the host. Only this launched flow may survive that pause.
            crossBoundary(request) { manager.startUpdateFlow(info, request.activity!!, options)
              .addOnSuccessListener { result ->
                if (active(request)) when (result) {
                  Activity.RESULT_OK -> resolve(request, "accepted")
                  Activity.RESULT_CANCELED -> resolve(request, "cancelled")
                  else -> reject(request, "APP_UPDATE_FAILED")
                }
              }.addOnFailureListener { if (active(request)) reject(request, "APP_UPDATE_FAILED") }
            }
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("complete") { token: String, promise: Promise ->
      begin(promise, token)?.let { request ->
        query(request) { manager, info ->
          assertCurrentActivity(request)
          val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
            info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if (!available || info.installStatus() != InstallStatus.DOWNLOADED) reject(request, "APP_UPDATE_NOT_DOWNLOADED")
          else crossBoundary(request) { manager.completeUpdate()
            .addOnSuccessListener { if (active(request)) resolve(request, null) }
            .addOnFailureListener { if (active(request)) reject(request, "APP_UPDATE_FAILED") }
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      revokePreflights()
    }
    OnActivityDestroys {
      synchronized(ticketLock) { tickets.clear() }
      onMain { pending.toList().forEach { reject(it, "APP_UPDATE_UNAVAILABLE") } }
    }
    OnDestroy {
      synchronized(ticketLock) {
        destroyed = true
        tickets.clear()
      }
      onMain {
        pending.toList().forEach { reject(it, "APP_UPDATE_UNAVAILABLE") }
        manager?.unregisterListener(installListener)
        manager = null
      }
    }
  }
}
