import type { NativeNotificationScope, NotificationRoute, NotificationSnapshot } from '../src/notifications/types.ts';

export type NotificationTestPort = {
  getSnapshot(): NotificationSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  getPendingOwner(): Promise<Readonly<{ accountId: string; accountType: string }> | null>;
  readTapAfterUnlock(id: string, revision: number, validate: (scope: NativeNotificationScope) => boolean): Promise<NotificationRoute | null>;
  consumeTap(id: string, revision: number): void;
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
  readTapAfterUnlock: async () => null,
  consumeTap: () => {},
  replaceAccountTypes: async (_types, _scopes, assertCurrent) => { assertCurrent(); },
};
