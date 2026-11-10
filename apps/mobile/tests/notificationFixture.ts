import type { NativeNotificationScope, NotificationRoute, NotificationSnapshot } from '../src/notifications/types.ts';

export type NotificationTestPort = {
  getSnapshot(): NotificationSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  getPendingOwner(): Promise<Readonly<{ accountId: string; accountType: string }> | null>;
  resolveTapAfterUnlock(id: string, validate: (scope: NativeNotificationScope) => boolean): Promise<NotificationRoute | null>;
  replaceAccountTypes(types: readonly string[], scopes: readonly NativeNotificationScope[], assertCurrent: () => void): Promise<void>;
};

const quiet: NotificationSnapshot = Object.freeze({ status: 'ready', enabledScopeIds: [], permission: 'unknown',
  background: 'unsupported', pendingEventId: null, lastRunAt: null });

/** Unsubscribed alerts cannot interfere with an unrelated screen fixture. */
export const quietActivityNotifications: NotificationTestPort = {
  getSnapshot: () => quiet,
  subscribe: () => () => {},
  load: async () => {},
  getPendingOwner: async () => null,
  resolveTapAfterUnlock: async () => null,
  replaceAccountTypes: async (_types, _scopes, assertCurrent) => { assertCurrent(); },
};
