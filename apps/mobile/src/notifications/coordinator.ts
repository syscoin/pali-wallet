import { detectActivityNotifications, type ActivityNotificationBaseline, type ActivityNotificationScope } from '../../../../source/shared/activityNotifications.ts';
import type { GuardianRecoveryObservation } from '../../../../source/utils/smartAccount/guardianStatus.ts';
import type { NativeNotificationScope, NotificationDelivery, NotificationDocument, NotificationRoute, NotificationSnapshot, NotificationStore } from './types.ts';
import { notificationCapabilities } from './capabilities.ts';

export const NOTIFICATION_LIMITS = Object.freeze({ scopes: 64, events: 128, scopesPerRun: 8, runMs: 25000 });
export const emptyNotificationDocument = (): NotificationDocument => ({ scopes: [], events: [], cursor: 0 });
const aborted = () => { throw new Error('Notification work expired'); };

/** The injected reader has only public read capabilities, never a live wallet controller. */
export class NativeNotificationCoordinator {
  private snapshot: NotificationSnapshot = Object.freeze({ status: 'loading', enabledScopeIds: [], permission: 'unknown', background: 'unknown', pendingEventId: null, lastRunAt: null });
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private inflight = new Map<string, { scope: NativeNotificationScope; generation: string; controller: AbortController }>();
  private readonly ports: {
    store: NotificationStore; delivery: NotificationDelivery;
    normalize(scope: NativeNotificationScope): NativeNotificationScope;
    factScope(scope: NativeNotificationScope): ActivityNotificationScope;
    read(scope: NativeNotificationScope, previous: ActivityNotificationBaseline | null, signal: AbortSignal, guard: () => void): Promise<{ transactions: readonly unknown[]; guardianObservation?: GuardianRecoveryObservation; historyReadSucceeded: boolean }>;
    randomId(): string; now?: () => number;
  };
  constructor(ports: NativeNotificationCoordinator['ports']) { this.ports = ports; }
  private transact<T>(action: (document: NotificationDocument) => Promise<T> | T, assertCurrent: () => void = () => undefined): Promise<T> {
    return this.ports.store.transact(action, assertCurrent);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<NotificationSnapshot>) { this.snapshot = Object.freeze({ ...this.snapshot, ...change }); for (const listener of this.listeners) listener(); }
  private now() { return (this.ports.now ?? Date.now)(); }
  private async refresh() {
    const enabledScopeIds = await this.transact((doc) => Object.freeze(doc.scopes.map((entry) => entry.scope.id)));
    this.publish({ status: 'ready', enabledScopeIds });
  }
  async load() {
    try {
      const permission = await this.ports.delivery.permission(false);
      const background = await this.ports.delivery.backgroundStatus();
      this.publish({ permission, background });
      if (permission !== 'granted') await this.disableAll();
      else {
        const ids = await this.transact((doc) => doc.events.map((event) => event.id));
        await this.ports.delivery.prune(ids);
        await this.refresh();
        if (this.snapshot.enabledScopeIds.length) await this.ports.delivery.register();
        else await this.ports.delivery.unregister();
      }
    } catch {
      this.publish({ status: 'unavailable' });
      // Corrupt/unreadable enrollment cannot authorize an old OS notification.
      await Promise.allSettled([this.ports.delivery.prune([]), this.ports.delivery.unregister()]);
    }
  }
  async enable(inputs: readonly NativeNotificationScope[], assertCurrent: () => void) {
    const check = () => { if (assertCurrent() !== undefined) throw new Error('Alert enrollment changed'); };
    check();
    if (!inputs.length || inputs.length > NOTIFICATION_LIMITS.scopes) throw new Error('Choose accounts for alerts');
    const scopes = inputs.map(this.ports.normalize);
    if (new Set(scopes.map((scope) => scope.id)).size !== scopes.length) throw new Error('Duplicate alert scope');
    if (scopes.some(scope => {
      const capability = notificationCapabilities(scope);
      return !capability.transactions && !capability.guardian;
    })) throw new Error('Alerts are unavailable for this account and network');
    const permission = await this.ports.delivery.permission(true);
    check();
    this.publish({ permission });
    if (permission !== 'granted') throw new Error('Allow notifications in device settings to enable alerts');
    await this.ports.store.initialize();
    check();
    const addedGenerations = new Set<string>();
    try {
      await this.transact((doc) => {
      check();
      const added = scopes.filter((scope) => !doc.scopes.some((entry) => entry.scope.id === scope.id));
      if (doc.scopes.length + added.length > NOTIFICATION_LIMITS.scopes) throw new Error('Too many alert accounts');
      for (const scope of scopes) {
        const previous = doc.scopes.find((entry) => entry.scope.id === scope.id);
        if (previous && JSON.stringify(previous.scope) !== JSON.stringify(scope)) throw new Error('Alert registration changed; turn alerts off before enabling it again');
        if (!previous) {
          const generation = this.ports.randomId(); addedGenerations.add(generation);
          doc.scopes.push({ scope, generation, baseline: null, enrolledAt: this.now() });
        }
      }
      check();
    }, check);
    check();
    await this.ports.delivery.register();
    check();
    await this.refresh();
    check();
    // First complete public snapshot establishes a silent baseline, including empty accounts.
    await this.runForeground();
    check();
    } catch (error) {
      // Only this attempt's newly enrolled generations are rolled back; a
      // concurrent newer enrollment or an existing user's choice is retained.
      if (addedGenerations.size) await this.revoke((_scope, generation) => addedGenerations.has(generation));
      throw error;
    }
  }
  async replaceScopes(inputs: readonly NativeNotificationScope[]) {
    const current = inputs.map(this.ports.normalize);
    await this.revoke((scope) => !current.some((entry) => entry.id === scope.id && JSON.stringify(entry) === JSON.stringify(scope)));
  }
  async replaceAccountTypes(accountTypes: readonly string[], inputs: readonly NativeNotificationScope[], assertCurrent: () => void) {
    const current = inputs.map(this.ports.normalize);
    try {
      assertCurrent();
      await this.revoke((scope) => accountTypes.includes(scope.accountType) &&
        !current.some((entry) => entry.id === scope.id && JSON.stringify(entry) === JSON.stringify(scope)), assertCurrent);
    } catch (error) {
      assertCurrent();
      this.publish({ status: 'unavailable' });
      throw error;
    }
  }
  async disableScope(id: string) { await this.revoke((scope) => scope.id === id); }
  async disableOwner(accountType: string, accountId: string) { await this.revoke((scope) => scope.accountType === accountType && scope.accountId === accountId); }
  async disableAll() { await this.revoke(() => true); }
  private async revoke(predicate: (scope: NativeNotificationScope, generation: string) => boolean, assertCurrent: () => void = () => undefined) {
    const removed = await this.transact((doc) => {
      const revoked = doc.scopes.filter((entry) => predicate(entry.scope, entry.generation));
      const ids = new Set(revoked.map((entry) => entry.scope.id));
      doc.scopes = doc.scopes.filter((entry) => !ids.has(entry.scope.id));
      const removed = doc.events.filter((event) => ids.has(event.scopeId)).map((event) => event.id);
      doc.events = doc.events.filter((event) => !ids.has(event.scopeId));
      return removed;
    }, assertCurrent);
    // The enrollment is durably gone. Stop later RPC steps in reads that were
    // already admitted, even if OS notification cleanup itself now fails.
    for (const active of this.inflight.values())
      if (predicate(active.scope, active.generation)) active.controller.abort();
    await Promise.all(removed.map((id) => this.ports.delivery.remove(id)));
    // Native enumeration also finds a notice posted just before a crashed process.
    const keep = await this.transact((doc) => doc.events.map((event) => event.id));
    await this.ports.delivery.prune(keep);
    await this.refresh();
    if (!this.snapshot.enabledScopeIds.length) await this.ports.delivery.unregister();
    if (this.snapshot.pendingEventId && !keep.includes(this.snapshot.pendingEventId)) this.publish({ pendingEventId: null });
  }
  recordTap(id: unknown) { if (typeof id === 'string' && /^pali-alert-[0-9a-f]{32}$/.test(id)) this.publish({ pendingEventId: id }); }
  async getPendingOwner(): Promise<Readonly<{ accountId: string; accountType: string }> | null> {
    const id = this.snapshot.pendingEventId;
    if (!id) return null;
    return this.transact((doc) => {
      const event = doc.events.find((entry) => entry.id === id);
      const enrolled = event && doc.scopes.find((entry) => entry.scope.id === event.scopeId && entry.generation === event.generation);
      if (!enrolled || this.snapshot.pendingEventId !== id) return null;
      return Object.freeze({ accountId: enrolled.scope.accountId, accountType: enrolled.scope.accountType });
    });
  }
  async shouldPresent(id: unknown): Promise<boolean> {
    if (typeof id !== 'string' || !/^pali-alert-[0-9a-f]{32}$/.test(id)) return false;
    return this.transact((doc) => {
      const event = doc.events.find((entry) => entry.id === id);
      return !!event && doc.scopes.some((entry) => entry.scope.id === event.scopeId && entry.generation === event.generation);
    });
  }
  async resolveTapAfterUnlock(id: string, validateCurrent: (scope: NativeNotificationScope) => boolean): Promise<NotificationRoute | null> {
    const route = await this.transact((doc) => {
      const event = doc.events.find((entry) => entry.id === id);
      const enrolled = event && doc.scopes.find((entry) => entry.scope.id === event.scopeId && entry.generation === event.generation);
      if (!event || !enrolled || validateCurrent(enrolled.scope) !== true) return null;
      const scope = enrolled.scope;
      return Object.freeze({ scopeId: scope.id, accountId: scope.accountId, accountType: scope.accountType, networkId: scope.network.id,
        kind: event.fact.kind, ...(event.fact.transactionHash ? { transactionHash: event.fact.transactionHash } : {}) });
    });
    // A different mode can decline this route while App selects its owner, and
    // another tap can arrive while the encrypted row is being resolved.
    if (route && this.snapshot.pendingEventId === id) this.publish({ pendingEventId: null });
    return route;
  }
  runForeground = () => this.run();
  run(signal?: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      // A delivery/storage failure is retryable, but never grants permission
      // to skip loading and validating the persisted enrollment again.
      if (this.snapshot.status !== 'ready') {
        await this.load();
        if (this.getSnapshot().status !== 'ready') return;
      }
      await this.poll(signal);
    })().catch((error: unknown) => {
      this.publish({ status: 'unavailable' });
      throw error;
    }).finally(() => { this.running = null; });
    return this.running;
  }
  private async poll(external?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) abort();
    const timer = setTimeout(abort, NOTIFICATION_LIMITS.runMs);
    try {
      const permission = await this.ports.delivery.permission(false);
      this.publish({ permission });
      if (permission !== 'granted') { await this.disableAll(); return; }
      const work = await this.transact((doc) => {
        const sorted = [...doc.scopes].sort((a, b) => a.scope.id.localeCompare(b.scope.id));
        const count = Math.min(sorted.length, NOTIFICATION_LIMITS.scopesPerRun);
        const batch = Array.from({ length: count }, (_, index) => sorted[(doc.cursor + index) % sorted.length]!);
        return batch;
      });
      for (const entry of work) {
        if (controller.signal.aborted) break;
        const local = new AbortController();
        const abortRead = () => local.abort();
        controller.signal.addEventListener('abort', abortRead, { once: true });
        const active = { scope: entry.scope, generation: entry.generation, controller: local };
        this.inflight.set(entry.scope.id, active);
        const guard = () => { if (controller.signal.aborted || local.signal.aborted) aborted(); };
        try {
          // The original batch may be stale after another account's await.
          // Re-admit this exact generation immediately before its public read.
          const admitted = await this.transact((doc) => {
            const current = doc.scopes.find(scope => scope.scope.id === entry.scope.id && scope.generation === entry.generation);
            if (!current) return null;
            doc.cursor = doc.scopes.length ? (doc.cursor + 1) % doc.scopes.length : 0;
            return current;
          }, guard);
          if (!admitted) continue;
          guard();
          const observation = await this.ports.read(admitted.scope, admitted.baseline, local.signal, guard);
          guard();
          await this.transact((doc) => {
            const current = doc.scopes.find((scope) => scope.scope.id === entry.scope.id && scope.generation === entry.generation);
            if (!current) return;
            const next = detectActivityNotifications({ scope: this.ports.factScope(current.scope), previous: current.baseline,
              ...observation, observedAt: this.now() });
            current.baseline = next.baseline;
            for (const fact of next.facts) doc.events.push({ id: this.ports.randomId(), scopeId: current.scope.id,
              generation: current.generation, fact, attempted: false, createdAt: this.now() });
            doc.events = doc.events.slice(-NOTIFICATION_LIMITS.events);
          }, guard);
        } catch { /* One failed public endpoint does not suppress other enabled accounts. */ }
        finally {
          local.abort(); controller.signal.removeEventListener('abort', abortRead);
          if (this.inflight.get(entry.scope.id) === active) this.inflight.delete(entry.scope.id);
        }
      }
      // Persist the attempt before entering the OS: process interruption may lose one notice,
      // but never replays a historical event. Do not hold a DB lock across OS callbacks:
      // the foreground presentation handler itself revalidates the same enrollment.
      const pending = await this.transact((doc) => doc.events.filter((event) => !event.attempted).map((event) => event.id));
      for (const id of pending) {
        if (controller.signal.aborted) break;
        const claimed = await this.transact((doc) => {
          const event = doc.events.find((entry) => entry.id === id);
          if (!event || event.attempted || !doc.scopes.some((entry) => entry.scope.id === event.scopeId && entry.generation === event.generation)) return false;
          event.attempted = true;
          return true;
        });
        if (!claimed) continue;
        if (controller.signal.aborted) aborted();
        if (!(await this.shouldPresent(id))) continue;
        try { await this.ports.delivery.post(id); }
        finally {
          // Disable/removal may win while the OS call is pending. Cancel both
          // queued and already-presented forms before allowing the task to end.
          if (!(await this.shouldPresent(id).catch(() => false))) await this.ports.delivery.remove(id);
        }
      }
      const keep = await this.transact((doc) => doc.events.map((event) => event.id));
      await this.ports.delivery.prune(keep);
      this.publish({ lastRunAt: this.now() });
      await this.refresh();
    } finally { clearTimeout(timer); external?.removeEventListener('abort', abort); controller.abort(); }
  }
}
