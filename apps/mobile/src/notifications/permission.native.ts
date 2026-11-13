import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createPermissionPresentation } from '../platform/permissionPresentation.ts';
import type { NotificationEnableOptions, NotificationPermissionResult } from './types.ts';

const presentation = createPermissionPresentation({
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
export async function requestNativeNotificationPermission(request = true, onPresentation?: NotificationEnableOptions['onPermissionPresentation']): Promise<'granted' | 'denied'> {
  const current = await Notifications.getPermissionsAsync();
  if (granted(current)) return 'granted';
  if (!request || !current.canAskAgain) return 'denied';
  let outcome: NotificationPermissionResult = null, finish: (value: NotificationPermissionResult) => void = () => undefined;
  try {
    const next = await presentation.run(async () => {
      const result = new Promise<NotificationPermissionResult>(resolve => { finish = resolve; });
      onPresentation?.(result);
      const response = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
      outcome = granted(response) ? 'granted' : 'denied';
      return response;
    });
    return granted(next) ? 'granted' : 'denied';
  } finally { finish(outcome); }
}
