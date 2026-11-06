package org.syscoin.pali.storage

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Standalone test-only activity. Production sources and manifest are untouched. */
class WatchNoticeProbe : Activity() {
  private enum class Phase { NEW, CHECKED, DENY_PROMPT, DENIED, ALLOW_PROMPT, ALLOWED, POSTING, POSTED, REMOVING, DONE, FAILED }
  private var phase = Phase.NEW
  private val main = Handler(Looper.getMainLooper())
  private lateinit var status: TextView
  private val manager by lazy { checkNotNull(getSystemService(NotificationManager::class.java)) }
  private val channelId = "pali.watch-confirmations"
  private val noticeId = "pali.watch-confirmation." + "a".repeat(32)
  private val controlId = "pali.watch-confirmation." + "b".repeat(32)
  private val numericId = 1
  private val requestCode = 41
  private val logTag = "PaliWatchNoticeProbe"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(48, 88, 48, 24)
    }
    status = TextView(this).apply { text = "Waiting for focus"; textSize = 18f }
    layout.addView(status)
    action(layout, "Check initial refusal", ::checkInitialRefusal)
    action(layout, "Request notification permission", ::requestNoticePermission)
    action(layout, "Post generic notice", ::postNotice)
    action(layout, "Remove exact notice", ::removeNotice)
    setContentView(layout)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && phase == Phase.NEW) report("Fixture ready")
  }

  private fun action(layout: LinearLayout, label: String, invoke: () -> Unit) {
    layout.addView(Button(this).apply {
      text = label
      isAllCaps = false
      setOnClickListener { verify(invoke) }
    })
  }

  private fun checkInitialRefusal() {
    check(phase == Phase.NEW && hasWindowFocus())
    check(PaliWatchNotice.prepareChannel(this)) { "quiet channel was not prepared" }
    assertQuietChannel()
    assertRefusal()
    phase = Phase.CHECKED
    report("Posting refused without permission")
  }

  private fun requestNoticePermission() {
    check(hasWindowFocus() && !allowed())
    phase = when (phase) {
      Phase.CHECKED -> Phase.DENY_PROMPT
      Phase.DENIED -> Phase.ALLOW_PROMPT
      else -> error("permission prompt out of order")
    }
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), requestCode)
  }

  override fun onRequestPermissionsResult(request: Int, names: Array<out String>, grants: IntArray) {
    super.onRequestPermissionsResult(request, names, grants)
    if (request != requestCode) return
    verify {
      check(names.singleOrNull() == Manifest.permission.POST_NOTIFICATIONS && grants.size == 1)
      val granted = grants[0] == PackageManager.PERMISSION_GRANTED
      check(granted == allowed())
      check(!present(noticeId) && !present(controlId)) { "prompt posted a notice" }
      if (phase == Phase.DENY_PROMPT) {
        check(!granted)
        // The window can still be transitioning out of the permission dialog.
        observe("activity focus after denial", { hasWindowFocus() }) {
          assertRefusal()
          phase = Phase.DENIED
          report("Permission denied; posting refused")
        }
      } else {
        check(phase == Phase.ALLOW_PROMPT && granted)
        observe("activity focus after grant", { hasWindowFocus() }) {
          phase = Phase.ALLOWED
          report("Permission granted; nothing posted")
        }
      }
    }
  }

  private fun assertRefusal() {
    check(hasWindowFocus() && !allowed() && !manager.areNotificationsEnabled())
    check(PaliWatchNotice.post(this, noticeId) == PaliWatchNotice.Admission.REFUSED)
    check(!present(noticeId) && !present(controlId))
  }

  private fun postNotice() {
    check(phase == Phase.ALLOWED && hasWindowFocus() && allowed() && manager.areNotificationsEnabled())
    assertQuietChannel()
    phase = Phase.POSTING
    val control = Notification.Builder(this, channelId)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Unrelated notification control")
      .setVisibility(Notification.VISIBILITY_SECRET)
      .build()
    manager.notify(controlId, numericId, control)
    check(PaliWatchNotice.post(this, noticeId) == PaliWatchNotice.Admission.REQUESTED)
    observe("real delivery", { present(noticeId) && present(controlId) }) {
      assertQuietChannel()
      val delivered = manager.activeNotifications.single { it.tag == noticeId && it.id == numericId }
      val notice = delivered.notification
      check(delivered.packageName == packageName && notice.channelId == channelId)
      check(notice.visibility == Notification.VISIBILITY_SECRET)
      check((notice.flags and Notification.FLAG_LOCAL_ONLY) != 0)
      check((notice.flags and Notification.FLAG_ONLY_ALERT_ONCE) != 0)
      check(notice.extras.getCharSequence(Notification.EXTRA_TITLE).toString() == "Watch Activity")
      check(notice.extras.getCharSequence(Notification.EXTRA_TEXT).toString() == "An explorer reports new confirmations.")
      check(!notice.extras.getBoolean(Notification.EXTRA_SHOW_WHEN, true))
      check(notice.contentIntent == null && notice.deleteIntent == null && notice.fullScreenIntent == null)
      check(notice.publicVersion == null && notice.actions.isNullOrEmpty())
      phase = Phase.POSTED
      report("Delivered generic secret notice and unrelated control")
    }
  }

  private fun removeNotice() {
    check(phase == Phase.POSTED && present(noticeId) && present(controlId))
    phase = Phase.REMOVING
    check(PaliWatchNotice.remove(this, noticeId))
    observe("exact removal", { !present(noticeId) && present(controlId) }) {
      val remaining = manager.activeNotifications.single { it.tag == controlId && it.id == numericId }
      check(remaining.notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString() == "Unrelated notification control")
      manager.cancel(controlId, numericId)
      phase = Phase.DONE
      report("Removed exact notice; unrelated control preserved")
    }
  }

  private fun assertQuietChannel() {
    val channel = checkNotNull(manager.getNotificationChannel(channelId))
    check(channel.importance in listOf(NotificationManager.IMPORTANCE_MIN, NotificationManager.IMPORTANCE_LOW))
    check(channel.lockscreenVisibility in listOf(-1000, Notification.VISIBILITY_SECRET))
    check(channel.sound == null && !channel.shouldVibrate() && !channel.shouldShowLights())
    check(!channel.canShowBadge() && !channel.canBypassDnd())
  }

  private fun present(tag: String) = manager.activeNotifications.any { it.tag == tag && it.id == numericId }
  private fun allowed() = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun observe(label: String, test: () -> Boolean, finish: () -> Unit, attempts: Int = 40) {
    verify {
      if (test()) finish()
      else {
        check(attempts > 1) { "could not observe $label" }
        main.postDelayed({ observe(label, test, finish, attempts - 1) }, 100)
      }
    }
  }

  private fun verify(run: () -> Unit) {
    if (phase == Phase.FAILED) return
    try { run() }
    catch (error: Exception) {
      phase = Phase.FAILED
      Log.e(logTag, "Fixture failed", error)
      report("FAIL: " + (error.message ?: error.javaClass.simpleName))
    }
  }

  private fun report(message: String) {
    status.text = message
    Log.i(logTag, message)
  }
}
