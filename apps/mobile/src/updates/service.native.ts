import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { readWalletReleaseFeed } from '../../../../source/shared/walletRelease';
import { WALLET_RELEASE_AUTOMATIC_INTERVAL_MS, WalletReleaseMonitor } from '../../../../source/shared/walletReleaseMonitor';
import { PALI_STORES } from '../../../../source/shared/walletStores';
import { walletFetch } from '../platform/http';
import type { MobileUpdateService, MobileUpdateSnapshot } from './types';
import { UPDATE_BACKGROUND_TASK } from './constants';
import { WALLET_BACKGROUND_INTERVAL_MINUTES } from '../notifications/constants';
import { requestNativeNotificationPermission } from '../notifications/permission.native';

const ALERTS_KEY = 'pali.update-alerts.v1';
const NOTICE_KEY = 'pali.update-notice.v1';
const LAST_CHECK_KEY = 'pali.update-last-check.v1';
const CHANNEL = 'pali-app-updates';
const platform = Platform.OS === 'android' ? 'android' : 'ios';
const version = Application.nativeApplicationVersion ?? '';
const build = Number(Application.nativeBuildVersion);
const monitor = new WalletReleaseMonitor({ current: { platform, version, ...(Number.isSafeInteger(build) && build > 0 ? { build } : {}) },
  async fetchFeed(signal) {
    const request = new AbortController(), cancel = () => request.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 8_000);
    try {
      const feed = await readWalletReleaseFeed(walletFetch, request.signal);
      return platform === 'ios' && !PALI_STORES.ios && feed ? { ...feed, releases: [] } : feed;
    }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); request.abort(); }
  },
});
let alertsEnabled = true;
let permission: MobileUpdateSnapshot['permission'] = 'unknown';
let snapshot: MobileUpdateSnapshot = Object.freeze({ ...monitor.getSnapshot(), alertsEnabled, permission });
const listeners = new Set<() => void>();
function publish() {
  snapshot = Object.freeze({ ...monitor.getSnapshot(), alertsEnabled, permission });
  for (const listener of [...listeners]) { try { listener(); } catch { /* Presentation cannot interrupt update checks. */ } }
}
monitor.subscribe(publish);
let loaded: Promise<void> | undefined, pending: Promise<void> | undefined;
let settingsEpoch = 0;
const load = () => loaded ??= AsyncStorage.getItem(ALERTS_KEY)
  .then(value => { alertsEnabled = value !== 'off'; publish(); })
  .catch(error => { loaded = undefined; throw error; });
const granted = (value: Notifications.NotificationPermissionsStatus) => value.granted ||
  // eslint-disable-next-line import/namespace -- Expo re-exports its runtime enum.
  value.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
let backgroundTail = Promise.resolve();
function syncBackground() {
  // A later opt-out always runs after an in-flight registration completes.
  backgroundTail = backgroundTail.catch(() => undefined).then(async () => {
    if (!await TaskManager.isAvailableAsync()) return;
    const registered = await TaskManager.isTaskRegisteredAsync(UPDATE_BACKGROUND_TASK);
    if (alertsEnabled && permission === 'granted') {
      const status = await BackgroundTask.getStatusAsync();
      if (!registered && alertsEnabled && permission === 'granted' && status === BackgroundTask.BackgroundTaskStatus.Available)
        await BackgroundTask.registerTaskAsync(UPDATE_BACKGROUND_TASK, { minimumInterval: WALLET_BACKGROUND_INTERVAL_MINUTES });
    } else if (registered) await BackgroundTask.unregisterTaskAsync(UPDATE_BACKGROUND_TASK);
  });
  return backgroundTail;
}
function noticeId() {
  const release = monitor.getSnapshot().release;
  return release ? `pali-update-${release.platform}-${release.version}-${release.build ?? 0}` : null;
}
async function notify() {
  const release = monitor.getSnapshot().release;
  if (!alertsEnabled || !release || release.severity === 'routine' || monitor.getSnapshot().status !== 'ready') return;
  const epoch = settingsEpoch, id = noticeId()!;
  permission = granted(await Notifications.getPermissionsAsync()) ? 'granted' : 'denied'; publish();
  if (permission !== 'granted' || !alertsEnabled || settingsEpoch !== epoch || await AsyncStorage.getItem(NOTICE_KEY) === id) return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, {
    // eslint-disable-next-line import/namespace -- Expo publicly re-exports runtime enum.
    name: 'Pali updates', importance: Notifications.AndroidImportance.DEFAULT,
  });
  if (!alertsEnabled || settingsEpoch !== epoch) return;
  // Persist before delivery: repeated background wakes must not repeatedly notify.
  await AsyncStorage.setItem(NOTICE_KEY, id);
  if (!alertsEnabled || settingsEpoch !== epoch) return;
  try {
    await Notifications.scheduleNotificationAsync({ identifier: id, content: {
      title: release.severity === 'critical' ? 'Important Pali security update' : 'Pali update available',
      body: `Version ${release.version} is available. Open Pali to review and update from your app store.`,
      sound: false,
    }, trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null });
  } catch (error) {
    // A refused delivery is retryable; do not remember it as a sent notice.
    if (await AsyncStorage.getItem(NOTICE_KEY) === id) await AsyncStorage.removeItem(NOTICE_KEY);
    throw error;
  }
  if (!alertsEnabled || settingsEpoch !== epoch) {
    await Notifications.cancelScheduledNotificationAsync(id); await Notifications.dismissNotificationAsync(id);
  }
}
export const mobileUpdates: MobileUpdateService = {
  getSnapshot: () => snapshot,
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  check(force = false) {
    if (pending) return pending;
    pending = (async () => {
      await load();
      const previous = monitor.getSnapshot().lastAttemptAt;
      await monitor.check({ force });
      const attempted = monitor.getSnapshot().lastAttemptAt;
      if (attempted !== null && attempted !== previous) await AsyncStorage.setItem(LAST_CHECK_KEY, String(attempted));
      permission = granted(await Notifications.getPermissionsAsync()) ? 'granted' : 'denied'; publish();
      await syncBackground();
      await notify();
    })().finally(() => { pending = undefined; });
    return pending;
  },
  async setAlerts(enabled) {
    await load();
    if (enabled) permission = await requestNativeNotificationPermission();
    ++settingsEpoch;
    alertsEnabled = enabled;
    await AsyncStorage.setItem(ALERTS_KEY, enabled ? 'on' : 'off'); publish();
    await syncBackground();
    if (!enabled) {
      const id = await AsyncStorage.getItem(NOTICE_KEY);
      if (id) { await Notifications.cancelScheduledNotificationAsync(id); await Notifications.dismissNotificationAsync(id); }
    }
  },
};
/** Expo shares one worker: retain the activity cadence, throttle only release I/O. */
export async function runMobileUpdateBackground(): Promise<void> {
  await load();
  if (!alertsEnabled) return;
  const previous = Number(await AsyncStorage.getItem(LAST_CHECK_KEY));
  const elapsed = Date.now() - previous;
  if (previous > 0 && elapsed >= 0 && elapsed < WALLET_RELEASE_AUTOMATIC_INTERVAL_MS) return;
  await mobileUpdates.check();
}
/** No URL or route is accepted from a notification payload. */
export async function isReleaseUpdateNotification(id: string): Promise<boolean> {
  await load();
  return alertsEnabled && /^pali-update-(?:android|ios)-[0-9.]+-\d+$/.test(id) && await AsyncStorage.getItem(NOTICE_KEY) === id;
}
export function startMobileUpdateLifecycle(): () => void {
  const check = () => { if (AppState.currentState === 'active') void mobileUpdates.check().catch(() => undefined); };
  check();
  const change = AppState.addEventListener('change', check);
  const interval = setInterval(check, WALLET_RELEASE_AUTOMATIC_INTERVAL_MS);
  return () => { change.remove(); clearInterval(interval); };
}
