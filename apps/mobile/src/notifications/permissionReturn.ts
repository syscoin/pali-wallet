import type { NativeNotificationScope, NotificationPermissionResult } from './types.ts';

export type NotificationReturnContext = Readonly<{ owner: object; identity: string; scopes: readonly NativeNotificationScope[] }>;
export type NotificationReturn = Readonly<{ scopeKey: string; permission: NotificationPermissionResult }>;
const key = (context: NotificationReturnContext) => JSON.stringify([context.identity, context.scopes]);

/** Public navigation only: an interrupted enrollment always needs a fresh guard. */
export class NotificationPermissionReturn {
  private pending: { owner: object; key: string; scopeKey: string; until: number; phase: 'request' | 'paused' | 'resumed'; permission?: NotificationPermissionResult } | null = null;
  private readonly changed: () => void;
  private readonly now: () => number;
  constructor(changed: () => void, now = Date.now) { this.changed = changed; this.now = now; }
  discard = () => { this.pending = null; };
  capture(context: NotificationReturnContext | null, scope: NativeNotificationScope, result: Promise<NotificationPermissionResult>): void {
    this.discard();
    const scopeKey = JSON.stringify(scope);
    if (!context || !context.scopes.some(value => JSON.stringify(value) === scopeKey)) return;
    const pending: NonNullable<typeof this.pending> = { owner: context.owner, key: key(context), scopeKey, until: this.now() + 120000, phase: 'request' };
    this.pending = pending;
    void result.then(permission => {
      if (this.pending !== pending) return;
      if (pending.phase === 'request') { this.discard(); return; }
      this.pending.permission = permission; this.changed();
    }, () => { if (this.pending === pending) this.discard(); });
  }
  private matches(context: NotificationReturnContext | null): boolean {
    return !!context && !!this.pending && this.now() <= this.pending.until && this.pending.owner === context.owner && this.pending.key === key(context);
  }
  pause(context: NotificationReturnContext | null): void {
    if (this.pending?.phase === 'paused') return;
    if (!this.matches(context) || this.pending?.phase !== 'request') { this.discard(); return; }
    this.pending.phase = 'paused';
  }
  resume(context: NotificationReturnContext | null): void {
    if (this.pending?.phase === 'resumed' && this.matches(context)) { this.changed(); return; }
    if (!this.matches(context) || this.pending?.phase !== 'paused') { this.discard(); return; }
    this.pending.phase = 'resumed'; this.changed();
  }
  take(context: NotificationReturnContext | null): NotificationReturn | null {
    if (!this.pending || this.pending.phase !== 'resumed' || this.pending.permission === undefined) return null;
    const pending = this.pending, valid = this.matches(context); this.discard();
    return valid ? { scopeKey: pending.scopeKey, permission: pending.permission! } : null;
  }
}
