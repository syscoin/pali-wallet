import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createNotificationPermissionPresentation } from './permissionPresentation.ts';

const presentation = createNotificationPermissionPresentation({
  current: () => AppState.currentState ?? 'unknown',
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },
});

export const isNotificationPermissionPromptActive = presentation.isActive;

function granted(permission: Notifications.NotificationPermissionsStatus): boolean {
  return permission.granted ||
    // eslint-disable-next-line import/namespace -- Expo publicly re-exports its runtime enum.
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** One process-wide OS permission owner, shared by every notification category. */
export async function requestNativeNotificationPermission(request = true): Promise<'granted' | 'denied'> {
  const current = await Notifications.getPermissionsAsync();
  if (granted(current)) return 'granted';
  if (!request || !current.canAskAgain) return 'denied';
  const next = await presentation.run(() => Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: false },
  }));
  return granted(next) ? 'granted' : 'denied';
}
