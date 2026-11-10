import { getEvmHistoryDirection } from '../../../../source/shared/evmHistory.ts';
import { NativeActivity, type ActivityRow, type NativeActivityRuntime, type ActivityExplorerPort, type ActivityReceiptPort } from './nativeActivity.ts';
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
export function accountActivityDirection(row: ActivityRow, owner: string) {
  const collectible = row.local?.collectibleTransfer;
  if (collectible) return getEvmHistoryDirection({ from: collectible.from, to: collectible.recipient }, owner);
  if (row.indexed) return getEvmHistoryDirection(row.indexed, owner);
  if (row.local) return getEvmHistoryDirection({ from: owner, to: row.local.recipient }, owner);
  return row.observation ? getEvmHistoryDirection(row.observation, owner, row.observation.events) : 'unknown';
}
const zeroOnly = (row: ActivityRow) => row.indexed ? row.zeroValueToken === true
  : !row.local && row.observation?.valueUnits === '0' && row.observation.events.length > 0 && row.observation.events.every(event => event.amountUnits === '0');

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
  private signature = '';
  private readonly reads = new ActivityReadConcurrency();
  private readonly ports: Ports;
  constructor(ports: Ports) { this.ports = ports; }
  getSnapshot = () => {
    if (!this.connection) return this.state;
    let current: ReturnType<AccountActivityController['context']> = null;
    try { current = this.context(); } catch { /* A retired owner cannot expose old activity. */ }
    if (!current || current.id !== this.state.accountId || JSON.stringify(current.choices) !== JSON.stringify(this.state.choices)) {
      this.stopChildren();
      this.state = Object.freeze({ ...initial(), view: this.state.view, filter: this.state.filter,
        status: current ? 'loading' : 'unavailable', accountId: current?.id ?? null, choices: current?.choices ?? [] });
    }
    return this.state;
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Notification targets are exact identities, independent of list filters. */
  findRow(networkId: string, hash: string): AccountActivityRow | undefined {
    this.getSnapshot();
    if (!this.connection || this.pendingFilter !== null) return undefined;
    for (const child of this.children.values()) {
      if (child.choice.scope.network.id !== networkId) continue;
      const row = child.controller.getSnapshot().rows.find(value => value.hash === hash);
      if (row) return { key: `${scopeKey(child.choice)}:${row.hash}`, choice: child.choice, row, controller: child.controller };
    }
    return undefined;
  }
  private context() {
    const state = this.ports.source.getSnapshot(), catalogue = this.ports.source.getCatalogue?.();
    if (!['ready', 'backup-required'].includes(state.phase) || !state.account || !catalogue) return null;
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
    const values = [...this.children.values()];
    const rows = values.flatMap(child => child.controller.getSnapshot().rows.map(row => ({
      key: `${scopeKey(child.choice)}:${row.hash}`, choice: child.choice, row, controller: child.controller,
    }))).filter(({ row, choice }) => {
      const direction = accountActivityDirection(row, choice.scope.accountAddress);
      return (this.state.view.showZero || !zeroOnly(row)) &&
        (this.state.view.filter === 'all' || (this.state.view.filter === 'sent' ? direction === 'sent' || direction === 'self' : direction === 'received' || direction === 'self'));
    }).sort((a, b) => (b.row.observation?.timestamp ?? b.row.candidate?.timestamp ?? b.row.local?.createdAt ?? 0) -
      (a.row.observation?.timestamp ?? a.row.candidate?.timestamp ?? a.row.local?.createdAt ?? 0) || a.key.localeCompare(b.key));
    const snapshots = values.map(child => child.controller.getSnapshot());
    const partial = snapshots.some(snapshot => snapshot.status === 'unavailable' || !!snapshot.error || snapshot.discoveryAvailable === false);
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
    if (!this.connection || !context || this.state.filter === null) {
      this.stopChildren();
      this.emit({ status: this.state.filter === null ? 'loading' : 'unavailable', accountId: null, choices: [], rows: [], refreshing: false, loadingMore: false, hasMore: false });
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
          ...(target.loadSavedPending ? { loadSavedPending: target.loadSavedPending.bind(target) } : {}),
          observeLocal: (record, guard, signal) => {
            const current = guarded(guard);
            return this.reads.run(signal, current, () => target.observeLocal!(record, current, signal));
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
        read: (hash, owner, signal, guard, network) => {
          const current = guarded(guard);
          return this.reads.run(signal, current, () => receipts.read(hash, owner, signal, current, network));
        },
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
  connect = () => {
    this.unsubscribe?.(); this.stopChildren();
    this.pendingFilter = null; this.filterIntent++;
    const connection = {}; this.connection = connection; this.state = Object.freeze({ ...initial(), view: this.state.view });
    this.unsubscribe = this.ports.source.subscribe(() => this.rebuild());
    void this.ports.filter.load().then(filter => {
      if (this.connection !== connection) return;
      this.state = Object.freeze({ ...this.state, filter }); this.rebuild();
    }).catch(() => { if (this.connection === connection) this.emit({ status: 'unavailable', error: 'Activity network filter is unavailable.' }); });
    return () => {
      if (this.connection !== connection) return;
      this.connection = null; this.pendingFilter = null; this.filterIntent++;
      this.unsubscribe?.(); this.unsubscribe = null; this.stopChildren(); this.emit({ ...initial(), view: this.state.view, status: 'unavailable' });
    };
  };
  async selectFilter(filter: string) {
    if (!this.connection || filter !== 'all' && !this.state.choices.some(choice => choice.scope.network.id === filter)) return;
    this.stopChildren(); const intent = ++this.filterIntent, connection = this.connection;
    this.pendingFilter = intent;
    this.emit({ rows: [], refreshing: false, loadingMore: false });
    try { await this.ports.filter.save(filter); }
    catch (error) {
      if (this.connection === connection && this.filterIntent === intent) {
        this.pendingFilter = null;
        // A failed write must not silently resume the former all-network view.
        this.state = Object.freeze({ ...this.state, filter: null });
        this.emit({ status: 'unavailable', partial: true, error: 'Activity network filter could not be saved.' });
      }
      throw error;
    }
    if (this.connection !== connection || this.filterIntent !== intent) return;
    this.pendingFilter = null;
    this.state = Object.freeze({ ...this.state, filter }); this.rebuild();
  }
  async setView(update: Partial<ActivityViewState>) {
    if (update.filter !== undefined && !['all', 'sent', 'received'].includes(update.filter) || update.showZero !== undefined && typeof update.showZero !== 'boolean')
      throw Error('Invalid activity filter');
    this.state = Object.freeze({ ...this.state, view: Object.freeze({ ...this.state.view, ...update }) });
    await Promise.all([...this.children.values()].map(child => child.controller.setView(update)));
    this.render();
  }
  refresh = async () => { await Promise.all([...this.children.values()].map(child => child.controller.refresh())); this.render(); };
  loadMore = async () => { await Promise.all([...this.children.values()].filter(child => child.controller.getSnapshot().hasMore).map(child => child.controller.loadMore())); this.render(); };
}
