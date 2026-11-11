import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { NativeNotificationCoordinator } from './coordinator.ts';
import { createNotificationReader, normalizeNotificationScope, notificationFactScope } from './reader.ts';
import { createNativeNotificationStore } from './store.native.ts';
import { ACTIVITY_BACKGROUND_TASK, ACTIVITY_NOTIFICATION_CHANNEL } from './constants.ts';
import type { NotificationDelivery } from './types.ts';
import { startNotificationLifecycle } from './lifecycle.ts';
import { createNotificationPermissionPresentation } from './permissionPresentation.ts';

const permissionPresentation = createNotificationPermissionPresentation({
  current: () => AppState.currentState ?? 'unknown',
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
});
export const isNotificationPermissionPromptActive = permissionPresentation.isActive;

function randomId() {
  return 'pali-alert-' + Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const acceptsPermission = (permission: Notifications.NotificationPermissionsStatus) =>
  // eslint-disable-next-line import/namespace -- Expo publicly re-exports this runtime enum from a .types module.
  permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
const delivery: NotificationDelivery = {
  async permission(request) {
    if (request && Platform.OS === 'android') await Notifications.setNotificationChannelAsync(ACTIVITY_NOTIFICATION_CHANNEL, {
      // eslint-disable-next-line import/namespace -- Expo's documented runtime enum is re-exported from a .types module.
      name: 'Account activity', importance: Notifications.AndroidImportance.DEFAULT,
      // eslint-disable-next-line import/namespace -- Expo's documented runtime enum is re-exported from a .types module.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE, sound: null,
    });
    const current = await Notifications.getPermissionsAsync();
    if (acceptsPermission(current)) return 'granted';
    if (!request || !current.canAskAgain) return 'denied';
    const next = await permissionPresentation.run(() => Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    }));
    return acceptsPermission(next) ? 'granted' : 'denied';
  },
  async backgroundStatus() {
    if (!(await TaskManager.isAvailableAsync())) return 'unsupported';
    return await BackgroundTask.getStatusAsync() === BackgroundTask.BackgroundTaskStatus.Available ? 'available' : 'restricted';
  },
  async register() {
    if (await delivery.backgroundStatus() === 'available' && !(await TaskManager.isTaskRegisteredAsync(ACTIVITY_BACKGROUND_TASK)))
      await BackgroundTask.registerTaskAsync(ACTIVITY_BACKGROUND_TASK, { minimumInterval: 15 });
  },
  async unregister() {
    if (await TaskManager.isTaskRegisteredAsync(ACTIVITY_BACKGROUND_TASK)) await BackgroundTask.unregisterTaskAsync(ACTIVITY_BACKGROUND_TASK);
  },
  async post(id) {
    if (await delivery.permission(false) !== 'granted') return;
    await Notifications.scheduleNotificationAsync({ identifier: id,
      content: { title: 'Pali', body: 'New account activity. Open Pali to review.', data: { eventId: id }, sound: false },
      trigger: Platform.OS === 'android' ? { channelId: ACTIVITY_NOTIFICATION_CHANNEL } : null });
  },
  async remove(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.dismissNotificationAsync(id);
  },
  async prune(keep) {
    const retained = new Set(keep);
    const [queued, shown] = await Promise.all([Notifications.getAllScheduledNotificationsAsync(), Notifications.getPresentedNotificationsAsync()]);
    const ids = new Set([...queued.map((item) => item.identifier), ...shown.map((item) => item.request.identifier)]);
    await Promise.all([...ids].filter((id) => /^pali-alert-[0-9a-f]{32}$/.test(id) && !retained.has(id)).map(delivery.remove));
  },
};
export const nativeActivityNotifications = new NativeNotificationCoordinator({ store: createNativeNotificationStore(), delivery,
  normalize: normalizeNotificationScope, factScope: notificationFactScope, read: createNotificationReader(), randomId });

// Notifications contain an opaque lookup ID only. Never interpret an OS payload as a route.
function receiveResponse(response: Notifications.NotificationResponse | null) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const request = response.notification.request;
  if (request.identifier !== request.content.data?.eventId) return;
  nativeActivityNotifications.recordTap(request.identifier);
}
Notifications.setNotificationHandler({
  async handleNotification(notification) {
    let allowed = false;
    try {
      if (notification.request.identifier.startsWith('pali-update-')) {
        const { isReleaseUpdateNotification } = await import('../updates/service.native');
        allowed = await isReleaseUpdateNotification(notification.request.identifier);
      } else allowed = notification.request.identifier === notification.request.content.data?.eventId &&
        await nativeActivityNotifications.shouldPresent(notification.request.identifier);
    } catch { /* Fail closed. */ }
    return { shouldShowBanner: allowed, shouldShowList: allowed, shouldPlaySound: false, shouldSetBadge: false };
  },
});
Notifications.addNotificationResponseReceivedListener(receiveResponse);
const load = nativeActivityNotifications.load.bind(nativeActivityNotifications);
nativeActivityNotifications.load = async () => {
  await load();
  receiveResponse(await Notifications.getLastNotificationResponseAsync());
  await Notifications.clearLastNotificationResponseAsync();
};

export async function runNotificationBackgroundTask(signal: AbortSignal): Promise<void> {
  // A scheduled OS wake must not consume the cold-start notification response.
  await load();
  if (nativeActivityNotifications.getSnapshot().status !== 'ready') throw new Error('Alert storage unavailable');
  await nativeActivityNotifications.run(signal);
}

let lifecycle: { users: number; stop: () => void } | null = null;
/** One foreground timer; acquiring twice cannot run a second monitor. */
export function startNativeNotificationLifecycle(): () => void {
  if (!lifecycle) lifecycle = { users: 0, stop: startNotificationLifecycle(nativeActivityNotifications, {
    current: () => AppState.currentState ?? 'unknown',
    subscribe(listener) { const subscription = AppState.addEventListener('change', listener); return () => subscription.remove(); },
    everyMinute(listener) { const timer = setInterval(listener, 60000); return () => clearInterval(timer); },
  }) };
  const owned = lifecycle; owned.users++;
  let stopped = false;
  return () => { if (stopped) return; stopped = true; if (--owned.users === 0) { owned.stop(); if (lifecycle === owned) lifecycle = null; } };
}
