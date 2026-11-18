import { matchesActivityView } from './activityFiltering.ts';
import { activityRowTimestamp, NativeActivity, type ActivityRow, type NativeActivityRuntime, type ActivityExplorerPort, type ActivityReceiptPort } from './nativeActivity.ts';
import { DEFAULT_ACTIVITY_VIEW, type ActivityViewState } from './types.ts';
import { ActivityReadConcurrency } from './readConcurrency.ts';
import type { PublicCustodySource } from '../portfolio/nativePortfolio.ts';
import type { NotificationChoice } from '../notifications/choices.ts';
import type { NativeNotificationScope } from '../notifications/types.ts';

export type AccountActivityRow = Readonly<{
  key: string;
  choice: NotificationChoice;
  row: ActivityRow;
  controller: NativeActivity;
}>;
export type AccountActivityNetwork = Pick<AccountActivityRow, 'choice' | 'controller'>;
export type AccountActivitySnapshot = Readonly<{
  status: 'loading' | 'ready' | 'unavailable';
  accountId: string | null;
  filter: string | null;
  choices: readonly NotificationChoice[];
  rows: readonly AccountActivityRow[];
  view: ActivityViewState;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  partial: boolean;
  error: string | null;
}>;
type Child = { choice: NotificationChoice; controller: NativeActivity; stop(): void; unsubscribe(): void };
type Ports = {
  source: PublicCustodySource;
  choices(): readonly NotificationChoice[];
  filter: { load(): Promise<string>; save(value: string): Promise<void> };
  runtime(scope: NativeNotificationScope, assertCurrent: () => void): NativeActivityRuntime | undefined;
  explorer: ActivityExplorerPort;
  receipts: ActivityReceiptPort;
};
const scopeKey = (choice: NotificationChoice) => JSON.stringify(choice.scope);
const initial = (): AccountActivitySnapshot => Object.freeze({
  status: 'loading', accountId: null, filter: null, choices: [], rows: [], view: DEFAULT_ACTIVITY_VIEW,
  refreshing: false, loadingMore: false, hasMore: false, partial: false, error: null,
});
export { activityRowDirection as accountActivityDirection } from './activityFiltering.ts';

/** Compose the established per-network Activity model; no new history backend,
 * account derivation, selection change, signing or persistent cache mutation.
 */
export class AccountActivityController {
  private state = initial();
  private listeners = new Set<() => void>();
  private children = new Map<string, Child>();
  private connection: object | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private filterIntent = 0;
  private pendingFilter: number | null = null;
  private filterStatus: 'pending' | 'failed' | 'ready' = 'pending';
  private filterRead: Promise<void> | null = null;
  private signature = '';
  private readonly reads = new ActivityReadConcurrency();
  private readonly ports: Ports;
  constructor(ports: Ports) { this.ports = ports; }
  getSnapshot = () => {
    if (!this.connection) return this.state;
    let current: ReturnType<AccountActivityController['context']> = null;
    try { current = this.context(); } catch { /* A retired owner cannot expose old activity. */ }
    if (!current && this.state.status === 'unavailable' && this.state.accountId === null && !this.state.choices.length && !this.state.rows.length)
      return this.state;
    if (!current || current.id !== this.state.accountId || JSON.stringify(current.choices) !== JSON.stringify(this.state.choices)) {
      this.stopChildren();
      this.state = Object.freeze({ ...initial(), view: this.state.view, filter: this.state.filter,
        status: current && this.filterStatus !== 'failed' ? 'loading' : 'unavailable',
        error: this.filterStatus === 'failed' ? this.state.error : null,
        accountId: current?.id ?? null, choices: current?.choices ?? [] });
    }
    return this.state;
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Only already-open networks for the current account and filter are exposed. */
  getNetwork(networkId: string): AccountActivityNetwork | undefined {
    this.getSnapshot();
    if (!this.connection || this.pendingFilter !== null) return undefined;
    const child = [...this.children.values()].find(value => value.choice.scope.network.id === networkId);
    return child ? { choice: child.choice, controller: child.controller } : undefined;
  }
  /** Notification targets are exact identities, independent of list filters. */
  findRow(networkId: string, hash: string): AccountActivityRow | undefined {
    this.getSnapshot();
    if (!this.connection || this.pendingFilter !== null) return undefined;
    for (const child of this.children.values()) {
      if (child.choice.scope.network.id !== networkId) continue;
      const row = child.controller.getSnapshot().rows.find(value => value.hash === hash ||
        value.smartAuthorizations?.some(item => item.instruction.operationHash === hash));
      if (row) return { key: `${scopeKey(child.choice)}:${row.hash}`, choice: child.choice, row, controller: child.controller };
    }
    return undefined;
  }
  private context() {
    const state = this.ports.source.getSnapshot(), catalogue = this.ports.source.getCatalogue?.();
    if (state.phase !== 'ready' || !state.account || !catalogue) return null;
    const choices = this.ports.choices().filter(choice => 'kind' in choice.scope.network && choice.scope.network.kind === 'evm' &&
      choice.scope.accountId === catalogue.active.accountId && choice.scope.accountAddress === state.account!.address);
    return { state, id: catalogue.active.accountId, choices };
  }
  private emit(update: Partial<AccountActivitySnapshot> = {}) {
    this.state = Object.freeze({ ...this.state, ...update });
    for (const listener of this.listeners) listener();
  }
  private stopChildren() {
    this.generation++;
    const old = [...this.children.values()]; this.children.clear(); this.signature = '';
    for (const child of old) { child.unsubscribe(); child.stop(); }
  }
  private render() {
    if (!this.connection || this.pendingFilter !== null || this.filterStatus !== 'ready' || this.state.filter === null) return;
    const values = [...this.children.values()];
    const rows = values.flatMap(child => child.controller.getSnapshot().rows.map(row => ({
      key: `${scopeKey(child.choice)}:${row.hash}`, choice: child.choice, row, controller: child.controller,
    }))).filter(({ row, choice }) => matchesActivityView(row, choice.scope.accountAddress, this.state.view, 'exclude'))
    .sort((a, b) => activityRowTimestamp(b.row) - activityRowTimestamp(a.row) || a.key.localeCompare(b.key));
    const snapshots = values.map(child => child.controller.getSnapshot());
    const partial = snapshots.some(snapshot => snapshot.status === 'unavailable' ||
      snapshot.status === 'ready' && !snapshot.loadingMore && (!!snapshot.error || snapshot.discoveryAvailable === false));
    this.emit({ rows: Object.freeze(rows), refreshing: snapshots.some(snapshot => snapshot.status === 'loading'),
      loadingMore: snapshots.some(snapshot => snapshot.loadingMore), hasMore: snapshots.some(snapshot => snapshot.hasMore), partial,
      error: partial ? 'Some network activity is unavailable.' : null });
  }
  private rebuild(force = false) {
    let context: ReturnType<AccountActivityController['context']> = null;
    try { context = this.context(); } catch { /* Retired public owner. */ }
    // Source updates cannot restart reads for the old filter while a new
    // preference is being persisted. Apply the latest saved intent first.
    if (this.pendingFilter !== null) return;
    if (!this.connection || !context || this.filterStatus !== 'ready' || this.state.filter === null) {
      this.stopChildren();
      this.emit({ status: context && this.filterStatus === 'pending' ? 'loading' : 'unavailable',
        accountId: context?.id ?? null, choices: context?.choices ?? [], rows: [], refreshing: false, loadingMore: false, hasMore: false,
        error: this.filterStatus === 'failed' ? this.state.error : null });
      return;
    }
    const visible = context.choices.filter(choice => this.state.filter === 'all' || choice.scope.network.id === this.state.filter);
    const signature = JSON.stringify([context.id, context.state.revision, this.state.filter, visible.map(scopeKey)]);
    if (!force && signature === this.signature) return;
    this.stopChildren(); this.signature = signature;
    const generation = this.generation, connection = this.connection;
    this.emit({ status: 'ready', accountId: context.id, choices: context.choices, rows: [], partial: false, error: null });
    for (const choice of visible) {
      const check = () => {
        const current = this.context();
        if (this.connection !== connection || this.generation !== generation || !current ||
          JSON.stringify([current.id, current.state.revision, this.state.filter,
            current.choices.filter(item => this.state.filter === 'all' || item.scope.network.id === this.state.filter).map(scopeKey)]) !== signature)
          throw Error('Activity scope changed');
      };
      let runtime: NativeActivityRuntime | undefined;
      try { check(); runtime = this.ports.runtime(choice.scope, check); } catch { /* A revoked scope remains unavailable. */ }
      const guarded = (guard: () => void) => () => { check(); guard(); };
      if (runtime?.observeLocal) {
        const target = runtime;
        runtime = { ...target,
          load: target.load.bind(target), saveCache: target.saveCache.bind(target), saveView: target.saveView.bind(target),
          ...(target.forScope ? { forScope: target.forScope.bind(target) } : {}),
          ...(target.loadTarget ? { loadTarget: target.loadTarget.bind(target) } : {}),
          ...(target.loadSavedPending ? { loadSavedPending: target.loadSavedPending.bind(target) } : {}),
          ...(target.observeSmartAuthorization ? { observeSmartAuthorization: (scope, hash, guard, signal) => {
            const current = guarded(guard);
            return this.reads.run(signal, current, () => target.observeSmartAuthorization!(scope, hash, current, signal));
          } } : {}),
          observeLocal: (record, guard, signal, observe) => {
            const current = guarded(guard);
            return this.reads.run(signal, current, () => target.observeLocal!(record, current, signal, observe));
          },
        };
      }
      const { explorer, receipts } = this.ports;
      const source = { getSnapshot: () => this.ports.source.getSnapshot(), subscribe: () => () => undefined };
      const controller = new NativeActivity(source, () => runtime, {
        page: (scope, feed, page, signal, guard) => {
          const current = guarded(guard);
          return this.reads.run(signal, current, () => explorer.page(scope, feed, page, signal, current));
        },
      }, {
        read: (hash, owner, signal, guard, network, sharingScope) => {
          const current = guarded(guard);
          return this.reads.run(signal, current, () => receipts.read(hash, owner, signal, current, network, sharingScope));
        },
        ...(receipts.retainedWave ? { retainedWave: (network, sharingScope, signal, guard) =>
          receipts.retainedWave!(network, sharingScope, signal, guarded(guard)),
        } : {}),
        ...(receipts.observe ? { observe: (request, signal, guard, network, sharingScope) => {
          const current = guarded(guard);
          return receipts.observe!(request, signal, current, network, sharingScope);
        } } : {}),
      });
      const key = scopeKey(choice);
      const child: Child = { choice, controller, stop: () => undefined, unsubscribe: () => undefined };
      this.children.set(key, child);
      child.unsubscribe = controller.subscribe(() => {
        if (this.children.get(key) !== child) return;
        const view = controller.getSnapshot().view;
        if (view.filter !== this.state.view.filter || view.showZero !== this.state.view.showZero) {
          void controller.setView({ filter: this.state.view.filter, showZero: this.state.view.showZero });
          return;
        }
        this.render();
      });
      child.stop = controller.connect();
    }
    this.render();
  }
  private loadFilter(): Promise<void> {
    if (!this.connection || this.pendingFilter !== null) return Promise.resolve();
    if (this.filterRead) return this.filterRead;
    const connection = this.connection, intent = this.filterIntent;
    this.filterStatus = 'pending';
    const current = () => this.connection === connection && this.filterIntent === intent && this.pendingFilter === null;
    const read = Promise.resolve().then(async () => {
      if (!current()) return;
      const filter = await this.ports.filter.load();
      if (!current()) return;
      this.filterStatus = 'ready';
      this.state = Object.freeze({ ...this.state, filter }); this.rebuild();
    }).catch(() => {
      if (!current()) return;
      this.filterStatus = 'failed';
      this.emit({ status: 'unavailable', error: 'Activity network filter is unavailable.' });
    }).finally(() => { if (this.filterRead === read) this.filterRead = null; });
    this.filterRead = read;
    this.emit({ status: 'loading', error: null });
    return read;
  }
  connect = () => {
    this.unsubscribe?.(); this.stopChildren();
    this.pendingFilter = null; this.filterIntent++; this.filterRead = null; this.filterStatus = 'pending';
    const connection = {}; this.connection = connection; this.state = Object.freeze({ ...initial(), view: this.state.view });
    this.unsubscribe = this.ports.source.subscribe(() => this.rebuild());
    void this.loadFilter();
    return () => {
      if (this.connection !== connection) return;
      this.connection = null; this.pendingFilter = null; this.filterIntent++; this.filterRead = null;
      this.unsubscribe?.(); this.unsubscribe = null; this.stopChildren(); this.emit({ ...initial(), view: this.state.view, status: 'unavailable' });
    };
  };
  async selectFilter(filter: string) {
    if (!this.connection || filter !== 'all' && !this.state.choices.some(choice => choice.scope.network.id === filter)) return;
    this.stopChildren(); const intent = ++this.filterIntent, connection = this.connection;
    this.filterRead = null;
    this.pendingFilter = intent;
    this.emit({ rows: [], refreshing: false, loadingMore: false });
    try { await this.ports.filter.save(filter); }
    catch (error) {
      if (this.connection === connection && this.filterIntent === intent) {
        this.pendingFilter = null;
        this.filterStatus = 'failed';
        // A failed write must not silently resume the former all-network view.
        this.state = Object.freeze({ ...this.state, filter: null });
        this.emit({ status: 'unavailable', partial: true, error: 'Activity network filter could not be saved.' });
      }
      throw error;
    }
    if (this.connection !== connection || this.filterIntent !== intent) return;
    this.pendingFilter = null;
    this.filterStatus = 'ready';
    this.state = Object.freeze({ ...this.state, filter }); this.rebuild();
  }
  async setView(update: Partial<ActivityViewState>) {
    if (update.filter !== undefined && !['all', 'sent', 'received'].includes(update.filter) || update.showZero !== undefined && typeof update.showZero !== 'boolean')
      throw Error('Invalid activity filter');
    this.state = Object.freeze({ ...this.state, view: Object.freeze({ ...this.state.view, ...update }) });
    await Promise.all([...this.children.values()].map(child => child.controller.setView(update)));
    this.render();
  }
  refresh = async () => {
    if (this.state.filter === null) { await this.loadFilter(); return; }
    await Promise.all([...this.children.values()].map(child => child.controller.refresh())); this.render();
  };
  loadMore = async () => { await Promise.all([...this.children.values()].filter(child => child.controller.getSnapshot().hasMore).map(child => child.controller.loadMore())); this.render(); };
}
