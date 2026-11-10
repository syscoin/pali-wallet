import type { NativeNotificationScope, NotificationRoute, NotificationSnapshot } from './types.ts';

const unavailable = async (): Promise<void> => { throw new Error('Account alerts require a native device'); };
const snapshot: NotificationSnapshot = Object.freeze({ status: 'ready', enabledScopeIds: [], permission: 'denied', background: 'unsupported', pendingEventId: null, lastRunAt: null });
/** Web review and unsupported resolvers neither persist nor request permissions. */
export const nativeActivityNotifications = {
  getSnapshot: () => snapshot,
  subscribe: (_listener: () => void) => () => undefined,
  load: async () => undefined,
  enable: async (_scopes: readonly NativeNotificationScope[], _assertCurrent: () => void) => unavailable(),
  replaceScopes: async (_scopes: readonly NativeNotificationScope[]) => undefined,
  replaceAccountTypes: async (_accountTypes: readonly string[], _scopes: readonly NativeNotificationScope[], _assertCurrent: () => void) => undefined,
  disableScope: async (_id: string) => undefined,
  disableOwner: async (_accountType: string, _accountId: string) => undefined,
  disableAll: async () => undefined,
  runForeground: async () => undefined,
  getPendingOwner: async (): Promise<Readonly<{ accountId: string; accountType: string }> | null> => null,
  resolveTapAfterUnlock: async (_id: string, _validate: (scope: NativeNotificationScope) => boolean): Promise<NotificationRoute | null> => null,
};
export const startNativeNotificationLifecycle = () => () => undefined;
export const isNotificationPermissionPromptActive = () => false;
