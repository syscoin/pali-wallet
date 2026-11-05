package org.syscoin.pali.storage

import android.app.Activity
import android.content.Intent
import android.os.CancellationSignal
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.jni.ArrayBuffer
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One main-thread slot for Android file selection and descriptor work across module instances. */
internal object PaliNoteBackupPicker {
  class Owner { val retired = AtomicBoolean(false) }

  private sealed interface Action {
    class Pick(val code: Int, val directory: Boolean) : Action {
      var dismissalAdmitted = false
    }
    class Write(val destination: Destination) : Action
  }

  private class Destination(val file: PaliNoteBackupSaf.Destination, val activity: WeakReference<Activity>) {
    val permit get() = file.permit
  }

  private class Request(
    val owner: Owner, val activity: WeakReference<Activity>, val action: Action, var promise: Promise?
  ) {
    val cancellation = CancellationSignal()
    val retired = AtomicBoolean(false)
    var working = false

    fun check() {
      if (retired.get() || owner.retired.get()) throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE)
      cancellation.throwIfCanceled()
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val requestCodes = PaliNoteBackupRequestCodes()
  private var pending: Request? = null
  private var destination: Destination? = null

  fun pick(owner: Owner, activity: Activity?, directory: Boolean, promise: Promise) {
    val focused = activity?.takeIf { !owner.retired.get() && !it.isFinishing && !it.isDestroyed && it.hasWindowFocus() }
    pending?.let { previous ->
      val old = previous.action as? Action.Pick
      val priorActivity = previous.activity.get()
      if (old != null && canReleaseNoteBackupPicker(
          previous.working, previous.owner.retired.get(), old.dismissalAdmitted,
          priorActivity, priorActivity?.isDestroyed != false, focused
        )
      ) {
        // RN can drop the cancellation result while replacing its React context.
        finish(previous, error = PaliNoteBackupFileError.UNAVAILABLE)
      }
    }
    if (pending != null) return reject(promise, PaliNoteBackupFileError.BUSY)
    if (focused == null) return reject(promise, PaliNoteBackupFileError.UNAVAILABLE)
    val code = requestCodes.take() ?: return reject(promise, PaliNoteBackupFileError.UNAVAILABLE)
    clearDestination()
    val request = Request(owner, WeakReference(focused), Action.Pick(code, directory), promise)
    pending = request
    try {
      request.check()
      @Suppress("DEPRECATION")
      focused.startActivityForResult(PaliNoteBackupSaf.pickerIntent(directory), code)
    } catch (_: Exception) {
      finish(request, error = PaliNoteBackupFileError.UNAVAILABLE)
    }
  }

  fun receive(owner: Owner, activity: Activity, code: Int, result: Int, intent: Intent?) {
    if (!PaliNoteBackupRequestCodes.contains(code)) return
    // Expo can replay startup events from a different thread.
    scope.launch(Dispatchers.Main.immediate) { receiveOnMain(owner, activity, code, result, intent) }
  }

  private fun receiveOnMain(owner: Owner, activity: Activity, code: Int, result: Int, intent: Intent?) {
    val request = pending ?: return
    val pick = request.action as? Action.Pick ?: return
    if (request.working || pick.code != code || request.activity.get() !== activity) return
    if (request.owner.retired.get()) { finish(request); return }
    if (request.owner !== owner) return
    if (activity.isDestroyed) { finish(request, error = PaliNoteBackupFileError.UNAVAILABLE); return }
    if (result == Activity.RESULT_CANCELED) { finish(request); return }
    val uri = PaliNoteBackupSaf.selection(result, intent, pick.directory)
    if (uri == null) { finish(request, error = PaliNoteBackupFileError.INVALID); return }
    val context = activity.applicationContext
    request.working = true
    scope.launch {
      val output = try {
        withContext(Dispatchers.IO) {
          if (pick.directory) {
            PaliNoteBackupSaf.destination(context, owner, uri, request.cancellation, request::check)
          } else {
            copyResult(PaliNoteBackupSaf.read(context, uri, request.cancellation, request::check))
          }
        }
      } catch (error: PaliNoteBackupFileException) {
        finish(request, error = error.error)
        return@launch
      } catch (_: Exception) {
        finish(request, error = PaliNoteBackupFileError.UNAVAILABLE)
        return@launch
      }
      if (output is PaliNoteBackupSaf.Destination) {
        if (request.retired.get() || owner.retired.get()) { finish(request); return@launch }
        destination = Destination(output, request.activity)
        val permit = output.permit
        scope.launch {
          delay(PaliNoteBackupDestinationPermit.LIFETIME_MS)
          if (destination?.permit === permit) clearDestination()
        }
        finish(request, value = output.permit.token)
      } else {
        finish(request, value = output as ArrayBuffer)
      }
    }
  }

  fun write(owner: Owner, token: String, bytes: ByteArray, promise: Promise) {
    val selected = destination
    if (selected == null || !selected.permit.matches(owner, token)) {
      return reject(promise, PaliNoteBackupFileError.UNAVAILABLE)
    }
    destination = null // Consume even on an invalid input or competing operation.
    if (pending != null || owner.retired.get() || selected.activity.get()?.isDestroyed != false ||
      !selected.permit.begin(SystemClock.elapsedRealtime())
    ) {
      selected.permit.revoke()
      return reject(promise, if (pending != null) PaliNoteBackupFileError.BUSY else PaliNoteBackupFileError.UNAVAILABLE)
    }
    try { PaliNoteBackupFile.checkExport(bytes) }
    catch (error: PaliNoteBackupFileException) {
      selected.permit.revoke()
      return reject(promise, error.error)
    }
    val request = Request(owner, selected.activity, Action.Write(selected), promise)
    request.working = true
    pending = request
    scope.launch {
      val output = try {
        withContext(Dispatchers.IO) {
          try {
            copyResult(PaliNoteBackupSaf.write(selected.file, bytes, request.cancellation, request::check))
          } finally {
            bytes.fill(0)
          }
        }
      } catch (error: PaliNoteBackupFileException) {
        finish(request, error = if (selected.permit.createAdmitted()) PaliNoteBackupFileError.WRITE_UNCONFIRMED else error.error)
        return@launch
      } catch (_: Exception) {
        finish(request, error = if (selected.permit.createAdmitted()) PaliNoteBackupFileError.WRITE_UNCONFIRMED else PaliNoteBackupFileError.UNAVAILABLE)
        return@launch
      }
      try { selected.permit.check(SystemClock.elapsedRealtime()) }
      catch (_: PaliNoteBackupFileException) { finish(request, error = PaliNoteBackupFileError.WRITE_UNCONFIRMED); return@launch }
      finish(request, value = output)
    }
  }

  fun revokeDestination(owner: Owner, token: String) {
    if (destination?.permit?.matches(owner, token) == true) clearDestination()
    val request = pending ?: return
    val write = request.action as? Action.Write ?: return
    if (write.destination.permit.matches(owner, token)) abandon(request)
  }

  fun activityDestroyed(owner: Owner) {
    scope.launch(Dispatchers.Main.immediate) {
      // The event has no Activity sender. A replay must not retire a newer live Activity.
      val selected = destination
      if (selected != null && selected.permit.ownedBy(owner) && selected.activity.get()?.isDestroyed != false) clearDestination()
      val request = pending?.takeIf { it.owner === owner && it.activity.get()?.isDestroyed != false } ?: return@launch
      if (request.working) abandon(request)
      else finish(request, error = PaliNoteBackupFileError.UNAVAILABLE)
    }
  }

  fun invalidate(owner: Owner) {
    owner.retired.set(true)
    scope.launch {
      if (destination?.permit?.ownedBy(owner) == true) clearDestination()
      val request = pending?.takeIf { it.owner === owner } ?: return@launch
      if (request.working) {
        abandon(request)
      } else {
        // A replacement owner can reclaim this only after dismissal and focus on the exact Activity.
        request.promise = null
        val pick = request.action as Action.Pick
        val activity = request.activity.get()
        if (activity == null || activity.isDestroyed) finish(request)
        else pick.dismissalAdmitted = runCatching { activity.finishActivity(pick.code) }.isSuccess
      }
    }
  }

  private fun clearDestination() {
    destination?.permit?.revoke()
    destination = null
  }

  private fun abandon(request: Request) {
    request.retired.set(true)
    val write = request.action as? Action.Write
    val uncertain = write?.destination?.permit?.revoke() == true
    val promise = request.promise
    request.promise = null
    if (promise != null && !request.owner.retired.get()) {
      reject(promise, if (uncertain) PaliNoteBackupFileError.WRITE_UNCONFIRMED else PaliNoteBackupFileError.UNAVAILABLE)
    }
    // Cancellation can call into a provider. The slot stays reserved until the worker returns.
    scope.launch(Dispatchers.IO) { runCatching { request.cancellation.cancel() } }
  }

  private fun finish(request: Request, value: Any? = null, error: PaliNoteBackupFileError? = null) {
    if (pending !== request) return
    pending = null
    val promise = request.promise
    request.promise = null
    if (promise == null || request.owner.retired.get() || request.retired.get()) return
    if (error != null) reject(promise, error) else promise.resolve(value)
  }

  private fun copyResult(bytes: ByteArray): ArrayBuffer = try {
    ArrayBuffer.copyOf(ByteBuffer.wrap(bytes))
  } finally {
    bytes.fill(0)
  }

  fun reject(promise: Promise, error: PaliNoteBackupFileError) = promise.reject(error.code, error.code, null)
}
