import type { NativeNetworkRegistration } from '../custody/networkContext.ts';
import type { UtxoRegistration } from '../core/utxoNetworks.ts';
import type { ActivityNotificationBaseline, ActivityNotificationFact } from '../../../../source/shared/activityNotifications.ts';

/** Public monitoring metadata only. These values never authorize a signature. */
export type NativeNotificationScope = Readonly<{
  id: string;
  accountId: string;
  accountType: string;
  accountAddress: string;
  network: NativeNetworkRegistration | UtxoRegistration;
  identifier?: string;
  isAccount?: boolean;
  guardian?: boolean;
}>;
export type NotificationSnapshot = Readonly<{
  status: 'loading' | 'ready' | 'unavailable';
  enabledScopeIds: readonly string[];
  permission: 'unknown' | 'granted' | 'denied';
  background: 'unknown' | 'available' | 'restricted' | 'unsupported';
  pendingEventId: string | null;
  lastRunAt: number | null;
}>;
export type NotificationRoute = Readonly<{
  scopeId: string; accountId: string; accountType: string; networkId: string;
  kind: ActivityNotificationFact['kind']; transactionHash?: string;
}>;
export type EnrolledScope = {
  scope: NativeNotificationScope; generation: string; baseline: ActivityNotificationBaseline | null;
  enrolledAt: number;
};
export type StoredNotification = {
  id: string; scopeId: string; generation: string; fact: ActivityNotificationFact;
  attempted: boolean; createdAt: number;
};
export type NotificationDocument = { scopes: EnrolledScope[]; events: StoredNotification[]; cursor: number };
export interface NotificationStore {
  initialize(): Promise<void>;
  /** Exclusive across foreground and background connections. No network reads inside. */
  transact<T>(action: (document: NotificationDocument) => Promise<T> | T, assertCurrent: () => void): Promise<T>;
}
export interface NotificationDelivery {
  permission(request: boolean): Promise<'granted' | 'denied'>;
  backgroundStatus(): Promise<NotificationSnapshot['background']>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  post(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Remove stale native notices, including ones left after a process interruption. */
  prune(keep: readonly string[]): Promise<void>;
}
