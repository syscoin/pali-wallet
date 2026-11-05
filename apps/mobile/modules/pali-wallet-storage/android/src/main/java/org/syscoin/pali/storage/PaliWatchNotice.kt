package org.syscoin.pali.storage

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Looper

/** One process-local slot. Call on Main with the host's current Activity and a never-reused ID. */
internal object PaliWatchNotice {
  private const val CHANNEL_ID = "pali.watch-confirmations"
  private const val ID_PREFIX = "pali.watch-confirmation."
  private const val NOTICE_ID = 1
  // Android 8's channel default. The public Ranking constant was added in API 31.
  private const val VISIBILITY_NO_OVERRIDE = -1000
  private const val TITLE = "Watch Activity"
  private const val BODY = "An explorer reports new confirmations."
  private var activeId: String? = null

  enum class Admission { REQUESTED, REFUSED, UNCONFIRMED }

  private fun valid(id: String): Boolean =
    id.length == ID_PREFIX.length + 32 && id.startsWith(ID_PREFIX) &&
      id.substring(ID_PREFIX.length).all { it in '0'..'9' || it in 'a'..'f' }

  private fun onMain(): Boolean = Looper.myLooper() === Looper.getMainLooper()

  private fun focused(activity: Activity): Boolean =
    !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()

  private fun quiet(channel: NotificationChannel?): Boolean =
    channel != null && channel.id == CHANNEL_ID &&
      (channel.importance == NotificationManager.IMPORTANCE_MIN ||
        channel.importance == NotificationManager.IMPORTANCE_LOW) &&
      // The system owns channel visibility. With no override, use the notice's SECRET visibility.
      (channel.lockscreenVisibility == VISIBILITY_NO_OVERRIDE ||
        channel.lockscreenVisibility == Notification.VISIBILITY_SECRET) &&
      channel.sound == null && !channel.shouldVibrate() && !channel.shouldShowLights() &&
      !channel.canShowBadge() && !channel.canBypassDnd()

  /** Host calls only from a current explicit setup action, separately from any permission prompt. */
  fun prepareChannel(activity: Activity): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !onMain() || !focused(activity)) return false
    return try {
      val manager = activity.getSystemService(NotificationManager::class.java) ?: return false
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        if (!focused(activity)) return false
        val channel = NotificationChannel(CHANNEL_ID, TITLE, NotificationManager.IMPORTANCE_LOW).apply {
          setSound(null, null)
          enableVibration(false)
          enableLights(false)
          setShowBadge(false)
          setBypassDnd(false)
        }
        manager.createNotificationChannel(channel)
      }
      quiet(manager.getNotificationChannel(CHANNEL_ID)) && focused(activity)
    } catch (_: RuntimeException) { false }
  }

  /** REQUESTED means the manager call returned, without a presentation acknowledgement. */
  fun post(activity: Activity, id: String): Admission {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        !onMain() || !valid(id) || activeId != null || !focused(activity)
    ) return Admission.REFUSED
    return try {
      val manager = activity.getSystemService(NotificationManager::class.java) ?: return Admission.REFUSED
      if (!manager.areNotificationsEnabled() || !quiet(manager.getNotificationChannel(CHANNEL_ID)))
        return Admission.REFUSED
      val notice = Notification.Builder(activity, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(TITLE)
        .setContentText(BODY)
        .setVisibility(Notification.VISIBILITY_SECRET)
        .setLocalOnly(true)
        .setShowWhen(false)
        .setOnlyAlertOnce(true)
        .build()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
          activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) return Admission.REFUSED
      if (!focused(activity)) return Admission.REFUSED
      activeId = id
      manager.notify(id, NOTICE_ID, notice)
      Admission.REQUESTED
    } catch (_: RuntimeException) {
      // If notify was attempted, retain the exact ID until its cancellation is requested.
      if (activeId == id) Admission.UNCONFIRMED else Admission.REFUSED
    }
  }

  /** Exact cancellation is safe after focus loss. A manager failure keeps the slot occupied. */
  fun remove(context: Context, id: String): Boolean {
    if (!onMain() || !valid(id)) return false
    return try {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return false
      manager.cancel(id, NOTICE_ID)
      if (activeId == id) activeId = null
      true
    } catch (_: RuntimeException) { false }
  }
}
