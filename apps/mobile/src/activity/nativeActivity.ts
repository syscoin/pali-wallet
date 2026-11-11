import {
  ActivityExplorerReader,
  ACTIVITY_PAGE_SIZE,
  type ActivityFeed,
} from './explorerReader.ts';
import {
  ActivityReceiptReader,
  type ActivityTransactionObservation,
} from './receiptReader.ts';
import {
  ActivityError,
  DEFAULT_ACTIVITY_VIEW,
  type ActivityCandidate,
  type EvmActivityReadScope,
  type ActivityViewState,
  type LocalActivityRecord,
  type IndexedActivityTransaction,
  activityCandidateSummary,
} from './types.ts';
import type { ActivityHistorySnapshot } from './historyStore.ts';
import {
  parseEvmInteger,
  selectEvmHistoryRepresentatives,
  mergeEvmExplorerTransactions,
} from '../../../../source/shared/evmHistory.ts';
import {
  getEvmTransactionDisplayInfo,
  type EvmTransactionDisplayInfo,
  type EvmDisplayTokenMetadata,
} from '../../../../source/shared/evmTransactionDisplay.ts';
import {
  buildEvmMinedNonceIndex,
  getEvmSettlementStatus,
  type EvmSettlementStatus,
} from '../../../../source/utils/evmReplacement.ts';
import type { EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import type { NativeTokenPortfolioScope } from '../portfolio/tokenRegistry.ts';

export interface NativeActivityRuntime {
  /** Selected-account public reads on an explicit saved network. */
  forScope?(scope: NativeTokenPortfolioScope, assertCurrent: () => void): NativeActivityRuntime;
  load(
    guard: () => void,
    signal?: AbortSignal
  ): Promise<{
    scope: EvmActivityReadScope;
    saved: ActivityHistorySnapshot;
    locals: readonly LocalActivityRecord[];
    assets?: readonly EvmDisplayTokenMetadata[];
  }>;
  loadSavedPending?(
    scope: EvmActivityReadScope,
    beforeHash: string | undefined,
    guard: () => void
  ): Promise<{
    records: readonly LocalActivityRecord[];
    nextCursor: string | null;
  }>;
  observeLocal?(
    record: LocalActivityRecord,
    guard: () => void,
    signal: AbortSignal
  ): Promise<EvmTransactionObservation>;
  saveCache(
    scope: EvmActivityReadScope,
    candidates: readonly ActivityCandidate[],
    guard: () => void
  ): Promise<void>;
  saveView(
    scope: EvmActivityReadScope,
    view: ActivityViewState,
    guard: () => void
  ): Promise<void>;
}
export type ActivityRow = Readonly<{
  hash: string;
  local?: LocalActivityRecord;
  candidate?: ActivityCandidate;
  observation?: ActivityTransactionObservation;
  indexed?: IndexedActivityTransaction;
  display?: EvmTransactionDisplayInfo;
  indexedStatus?: EvmSettlementStatus;
  zeroValueToken?: boolean;
  retainedObservation?: EvmTransactionObservation;
  checking: boolean;
  unavailable: boolean;
}>;
export type NativeActivitySnapshot = Readonly<{
  status: 'locked' | 'loading' | 'ready' | 'unavailable';
  rows: readonly ActivityRow[];
  view: ActivityViewState;
  accountAddress: string | null;
  scopeKey: string | null;
  chainId: string | null;
  registrationHash?: string | null;
  networkName?: string | null;
  nativeSymbol?: string | null;
  explorerUrl: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  coverage: string;
  truncated: boolean;
  discoveryAvailable?: boolean;
  canViewSavedPending?: boolean;
  savedPending?: Readonly<{
    rows: readonly ActivityRow[];
    status: 'loading' | 'ready' | 'unavailable';
    hasMore: boolean;
  }>;
}>;
export type ActivityLifecycleSnapshot = Readonly<{
  phase: string;
  revision: number;
}>;
export type ActivityLifecycle = {
  getSnapshot(): ActivityLifecycleSnapshot;
  subscribe(listener: () => void): () => void;
};
export type ActivityExplorerPort = Pick<ActivityExplorerReader, 'page'>;
export type ActivityReceiptPort = Pick<ActivityReceiptReader, 'read'>;
export type EvmActivityReaders = Readonly<{
  explorer: ActivityExplorerPort;
  receipts: ActivityReceiptPort;
}>;
type FeedState = {
  page: number;
  done: boolean;
  frontier: bigint | null;
  fingerprint: string | null;
  error: boolean;
};
type SavedPendingPage = {
  lifetime: AbortController;
  records: Map<string, LocalActivityRecord>;
  cursor: string | null | undefined;
  status: NonNullable<NativeActivitySnapshot['savedPending']>['status'];
};
type ActivityDetailRequest = Readonly<{ hash: string; page?: SavedPendingPage }>;
const initial = (): NativeActivitySnapshot =>
  Object.freeze({
    status: 'locked',
    rows: [],
    view: DEFAULT_ACTIVITY_VIEW,
    accountAddress: null,
    scopeKey: null,
    chainId: null,
    registrationHash: null,
    networkName: null,
    nativeSymbol: null,
    explorerUrl: null,
    loadingMore: false,
    hasMore: false,
    error: null,
    coverage:
      'Direct transactions and ERC20 transfer events from the selected network are included.',
    truncated: false,
    discoveryAvailable: false,
    canViewSavedPending: false,
    savedPending: undefined,
  });

/** Account-bound read model. Neither network results nor this controller can sign. */
export class NativeActivity {
  private snapshot = initial();
  private listeners = new Set<() => void>();
  private scope: EvmActivityReadScope | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private visible = 20;
  private indexed = new Map<string, IndexedActivityTransaction>();
  private displays = new Map<string, EvmTransactionDisplayInfo>();
  private tokenEvents = new Map<string, Readonly<Record<string, unknown>>>();
  private assets: readonly EvmDisplayTokenMetadata[] = [];
  private retainedObservations = new Map<string, EvmTransactionObservation>();
  private cachedFallback = false;
  private candidates = new Map<string, ActivityCandidate>();
  private freshCandidates = new Set<string>();
  private locals = new Map<string, LocalActivityRecord>();
  private savedPending?: SavedPendingPage;
  private observations = new Map<string, ActivityTransactionObservation>();
  private unavailable = new Set<string>();
  private checking = new Map<string, ActivityDetailRequest>();
  private feeds: Record<ActivityFeed, FeedState> = {
    txlist: this.feed(),
    tokentx: this.feed(),
  };
  private hydration: ActivityDetailRequest[] = [];
  private workers = 0;
  private readonly source: ActivityLifecycle;
  private readonly runtime: () => NativeActivityRuntime | undefined;
  private readonly explorer: ActivityExplorerPort;
  private readonly receipts: ActivityReceiptPort;
  constructor(
    source: ActivityLifecycle,
    runtime: () => NativeActivityRuntime | undefined,
    explorer: ActivityExplorerPort = new ActivityExplorerReader(),
    receipts: ActivityReceiptPort = new ActivityReceiptReader()
  ) {
    this.source = source;
    this.runtime = runtime;
    this.explorer = explorer;
    this.receipts = receipts;
  }
  private feed(): FeedState {
    return {
      page: 1,
      done: false,
      frontier: null,
      fingerprint: null,
      error: false,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(update: Partial<NativeActivitySnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...update });
    for (const listener of this.listeners) listener();
  }
  connect(): () => void {
    let revision = -1;
    const update = () => {
      const state = this.source.getSnapshot();
      if (state.revision === revision) return;
      revision = state.revision;
      if (!['ready', 'backup-required'].includes(state.phase)) {
        this.stop();
        this.publish(initial());
      } else void this.refresh();
    };
    const unsubscribe = this.source.subscribe(update);
    update();
    return () => {
      unsubscribe();
      this.stop();
      this.publish(initial());
    };
  }
  private stop() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.scope = null;
    this.savedPending?.lifetime.abort();
    this.savedPending = undefined;
    this.hydration = [];
    this.checking.clear();
  }
  private guard(
    generation: number,
    revision: number,
    signal = this.request?.signal
  ) {
    if (
      generation !== this.generation ||
      signal?.aborted ||
      !['ready', 'backup-required'].includes(this.source.getSnapshot().phase) ||
      this.source.getSnapshot().revision !== revision
    )
      throw new ActivityError('CANCELLED');
  }
  invalidate(): void {
    this.stop();
    this.candidates.clear();
    this.freshCandidates.clear();
    this.locals.clear();
    this.observations.clear();
    this.unavailable.clear();
    this.visible = 20;
    this.feeds = { txlist: this.feed(), tokentx: this.feed() };
    this.tokenEvents.clear();
    this.indexed.clear();
    this.displays.clear();
    this.retainedObservations.clear();
    this.assets = [];
    this.cachedFallback = true;
    this.publish(initial());
  }
  async refresh(): Promise<void> {
    this.invalidate();
    const generation = this.generation;
    const revision = this.source.getSnapshot().revision;
    this.request = new AbortController();
    const signal = this.request.signal;
    const guard = () => this.guard(generation, revision);
    this.publish({ ...initial(), status: 'loading' });
    try {
      const runtime = this.runtime();
      if (!runtime) throw new ActivityError('UNAVAILABLE');
      const { scope, saved, locals, assets } = await runtime.load(
        guard,
        signal
      );
      guard();
      this.scope = scope;
      this.assets = assets ?? [];
      for (const record of saved.archived) this.locals.set(record.hash, record);
      for (const local of locals) this.locals.set(local.hash, local);
      for (const record of saved.candidates)
        this.candidates.set(record.hash, record);
      this.publish({
        status: 'ready',
        view: saved.view,
        accountAddress: scope.address,
        scopeKey: scope.key,
        chainId: scope.network.chainId,
        registrationHash: scope.network.registrationHash,
        networkName: scope.network.name,
        nativeSymbol: scope.network.symbol,
        explorerUrl: scope.explorerUrl,
        truncated: saved.truncated,
        discoveryAvailable: !!scope.apiUrl,
        canViewSavedPending: !!runtime.loadSavedPending,
      });
      this.renderRows(true);
      this.observeRetained();
      if (!scope.apiUrl) {
        this.feeds.txlist.done = true;
        this.feeds.tokentx.done = true;
        this.publish({
          coverage: 'Activity discovery is unavailable for this network.',
        });
        this.renderRows(true);
        return;
      }
      const timeout = setTimeout(() => {
        if (generation === this.generation) this.request?.abort();
      }, 30000);
      try {
        await this.fill(guard, signal);
        guard();
        await runtime.saveCache(
          scope,
          this.orderedCandidates().slice(0, 24).map(activityCandidateSummary),
          guard
        );
        guard();
      } finally {
        clearTimeout(timeout);
      }
      this.cachedFallback = false;
      this.renderRows();
    } catch {
      if (generation !== this.generation) return;
      this.cachedFallback = true;
      this.publish({
        status: this.scope ? 'ready' : 'unavailable',
        error:
          'Activity could not be fully loaded. Previously loaded transactions remain visible.',
        loadingMore: false,
      });
      this.renderRows(true);
    }
  }
  private orderedCandidates(includeCached = false): ActivityCandidate[] {
    const frontiers = Object.values(this.feeds)
      .filter((f) => !f.done && !f.error)
      .map((f) => f.frontier);
    const floor = frontiers.some((f) => f === null)
      ? null
      : frontiers.reduce<bigint>((max, f) => (f! > max ? f! : max), 0n);
    return [...this.candidates.values()]
      .filter(
        (c) =>
          includeCached || (floor !== null && BigInt(c.blockNumber) >= floor)
      )
      .sort((a, b) =>
        BigInt(a.blockNumber) === BigInt(b.blockNumber)
          ? a.hash.localeCompare(b.hash)
          : BigInt(a.blockNumber) > BigInt(b.blockNumber)
          ? -1
          : 1
      );
  }
  private async fill(guard: () => void, signal: AbortSignal): Promise<void> {
    if (!this.scope) return;
    this.publish({ loadingMore: true });
    for (
      let calls = 0;
      calls < 6 && this.orderedCandidates().length < this.visible;
      calls++
    ) {
      const names = (['txlist', 'tokentx'] as ActivityFeed[]).filter(
        (name) => !this.feeds[name].done && !this.feeds[name].error
      );
      names.sort((a, b) => {
        const aa = this.feeds[a].frontier,
          bb = this.feeds[b].frontier;
        return aa === null ? -1 : bb === null ? 1 : aa > bb ? -1 : 1;
      });
      const name = names[0];
      if (!name) break;
      const feed = this.feeds[name];
      try {
        const rows = await this.explorer.page(
          this.scope,
          name,
          feed.page,
          signal,
          guard
        );
        guard();
        const fingerprint = JSON.stringify(
          rows.map((r) => [r.hash, r.blockNumber])
        );
        // The same shared source-priority merge keeps real transaction bodies
        // ahead of token-event placeholders. All indexed facts remain transient.
        for (const row of rows) if (row.tokenEvent && !this.tokenEvents.has(row.hash)) this.tokenEvents.set(row.hash, row.tokenEvent);
        const merged = mergeEvmExplorerTransactions(
          [...this.indexed.values()].map(indexed => ({ ...indexed, candidateSummary: this.candidates.get(indexed.hash.toLowerCase())! })),
          [...this.tokenEvents.values()],
          Number(this.scope.network.chainId),
          true,
          rows.map(row => ({ ...row.indexed, candidateSummary: activityCandidateSummary(row) }))
        );
        const byHash = new Map(
          merged.map((row) => [row.hash.toLowerCase(), row])
        );
        for (const row of rows) {
          if (!this.candidates.has(row.hash) && this.candidates.size >= 240)
            continue;
          const { candidateSummary, ...indexed } = byHash.get(row.hash)!;
          this.candidates.set(row.hash, candidateSummary);
          this.indexed.set(row.hash, Object.freeze(indexed));
          this.freshCandidates.add(row.hash);
        }
        await Promise.all(
          rows.map(async (row) => {
            const indexed = this.indexed.get(row.hash);
            if (!indexed) return;
            try {
              const display = await getEvmTransactionDisplayInfo(
                indexed,
                this.scope!.network.symbol,
                {
                  chainId: Number(this.scope!.network.chainId),
                  assets: this.assets,
                }
              );
              guard();
              this.displays.set(row.hash, Object.freeze(display));
            } catch {
              guard();
              this.displays.delete(row.hash);
            }
          })
        );
        guard();
        feed.fingerprint = fingerprint;
        feed.page++;
        feed.done = rows.length < ACTIVITY_PAGE_SIZE;
        feed.frontier = rows.length
          ? rows.reduce(
              (min, row) =>
                BigInt(row.blockNumber) < min ? BigInt(row.blockNumber) : min,
              BigInt(rows[0]!.blockNumber)
            )
          : 0n;
        if (this.candidates.size >= 240) {
          this.feeds.txlist.done = true;
          this.feeds.tokentx.done = true;
          this.publish({ truncated: true });
        }
      } catch {
        guard();
        feed.error = true;
        this.publish({
          error:
            'One activity feed is unavailable. Retry to load a complete page.',
        });
      }
    }
    guard();
    this.publish({
      loadingMore: false,
      error: Object.values(this.feeds).some((feed) => feed.error)
        ? this.snapshot.error
        : null,
    });
    this.renderRows();
  }
  async loadMore(): Promise<void> {
    if (
      this.snapshot.loadingMore ||
      !this.scope ||
      !this.request ||
      (this.visible >= 200 && this.orderedCandidates().length >= this.visible)
    )
      return;
    if (this.request.signal.aborted) {
      await this.refresh();
      return;
    }
    // Retries and duplicate event pages continue the current target. They do
    // not consume capacity that is reserved for distinct transactions.
    if (this.orderedCandidates().length >= this.visible)
      this.visible = Math.min(200, this.visible + 20);
    const generation = this.generation,
      revision = this.source.getSnapshot().revision;
    const guard = () => this.guard(generation, revision);
    for (const feed of Object.values(this.feeds)) feed.error = false;
    try {
      await this.fill(guard, this.request.signal);
      guard();
      await this.runtime()?.saveCache(
        this.scope,
        this.orderedCandidates().slice(0, 24).map(activityCandidateSummary),
        guard
      );
    } catch {
      if (generation === this.generation)
        this.publish({
          loadingMore: false,
          error:
            'Older activity is unavailable. Retry without losing the current list.',
        });
    }
  }
  /** Pages only the authenticated local journal. No explorer or receipt reads. */
  async loadSavedPending(): Promise<void> {
    const runtime = this.runtime(), scope = this.scope;
    if (!scope || !runtime?.loadSavedPending) return;
    if (this.savedPending?.status === 'loading' || this.savedPending?.cursor === null) return;
    // An explorer timeout only retires explorer work. The journal still
    // belongs to this wallet revision and the currently open saved page.
    const page = this.savedPending ??= { lifetime: new AbortController(), records: new Map(), cursor: undefined, status: 'ready' };
    const generation = this.generation, revision = this.source.getSnapshot().revision;
    const guard = () => {
      this.guard(generation, revision, page.lifetime.signal);
      if (this.savedPending !== page || this.runtime() !== runtime) throw new ActivityError('CANCELLED');
    };
    page.status = 'loading';
    this.renderRows();
    try {
      guard();
      const result = await runtime.loadSavedPending(scope, page.cursor ?? undefined, guard);
      guard();
      for (const row of result.records) page.records.set(row.hash, row);
      page.cursor = result.nextCursor;
      page.status = 'ready';
    } catch {
      try { guard(); } catch { return; }
      page.status = 'unavailable';
    }
    this.renderRows();
  }
  closeSavedPending(): void {
    this.savedPending?.lifetime.abort();
    this.savedPending = undefined;
    this.publish({ savedPending: undefined });
  }
  private renderRows(includeCached = this.cachedFallback) {
    const records = new Map<string, ActivityRow>();
    const candidates = this.orderedCandidates(includeCached);
    for (const local of this.locals.values())
      records.set(local.hash, {
        hash: local.hash,
        local,
        checking: false,
        unavailable: false,
      });
    for (const candidate of candidates.slice(0, this.visible))
      records.set(candidate.hash, {
        ...records.get(candidate.hash),
        hash: candidate.hash,
        candidate,
        checking: false,
        unavailable: false,
      });
    const mined = buildEvmMinedNonceIndex(
      [...this.indexed.values()],
      Number(this.scope?.network.chainId)
    );
    const observeRow = (row: ActivityRow, includeIndex = true): ActivityRow => {
      // An indexer describes the outer payer transaction; this row represents its verified inner operation.
      if (row.local?.smartAccount) includeIndex = false;
      const indexed = includeIndex ? this.indexed.get(row.hash) : undefined;
      const display = includeIndex ? this.displays.get(row.hash) : undefined;
      return {
        ...row,
        observation: this.observations.get(row.hash),
        indexed,
        display,
        indexedStatus: indexed
          ? getEvmSettlementStatus(indexed, Number(this.scope?.network.chainId), mined)
          : undefined,
        zeroValueToken:
          !!display?.isErc20Transfer &&
          !display.isNft &&
          !display.amountUnavailable &&
          /^0(?:\.0*)?$/.test(String(display.displayValue)),
        retainedObservation: this.retainedObservations.get(row.hash),
        checking: this.checking.has(row.hash),
        unavailable: this.unavailable.has(row.hash),
      };
    };
    const observedRows = [...records.values()].map((row) => observeRow(row));
    const representatives = selectEvmHistoryRepresentatives(
      observedRows.map((row) => ({
        row,
        hash: row.hash,
        historySource: row.indexed?.historySource,
        from:
          row.indexed?.from ??
          row.observation?.from ??
          row.local?.smartAccount?.payer ??
          (row.local ? this.scope?.address : undefined),
        nonce: parseEvmInteger(
          row.indexed?.nonce ?? row.observation?.nonce ?? row.local?.nonce
        ),
        confirmations:
          row.indexed?.confirmations ?? (row.observation?.block ? 1 : 0),
        blockNumber: row.indexed?.blockNumber ?? row.observation?.block?.number,
        blockHash: row.indexed?.blockHash ?? row.observation?.block?.hash,
        timestamp:
          row.observation?.timestamp ??
          row.candidate?.timestamp ??
          row.local?.createdAt ??
          0,
      })),
      observedRows.length
    ).map(({ row }) => row);
    // Local attempts remain inspectable, just as the extension retains its
    // local replacement history after choosing the fetched representative.
    const retained = new Map(representatives.map((row) => [row.hash, row]));
    for (const row of observedRows) if (row.local) retained.set(row.hash, row);
    const rows = [...retained.values()].sort(
      (a, b) =>
        (b.observation?.timestamp ??
          b.candidate?.timestamp ??
          b.local?.createdAt ??
          0) -
        (a.observation?.timestamp ??
          a.candidate?.timestamp ??
          a.local?.createdAt ??
          0)
    );
    const moreToLoad = Object.values(this.feeds).some((f) => !f.done);
    const atDisplayLimit = this.visible >= 200 && candidates.length >= 200;
    const pending = this.savedPending;
    this.publish({
      rows,
      savedPending: pending ? Object.freeze({
        rows: Object.freeze([...pending.records.values()].map((local) => observeRow({
          hash: local.hash, local, checking: false, unavailable: false,
        }, false))),
        status: pending.status,
        hasMore: pending.cursor !== null,
      }) : undefined,
      hasMore:
        !atDisplayLimit && (candidates.length > this.visible || moreToLoad),
      truncated:
        this.snapshot.truncated ||
        (atDisplayLimit && (candidates.length > this.visible || moreToLoad)),
      coverage: this.scope?.apiUrl
        ? 'Direct transactions and token transfer events from the selected explorer. Internal transfers are not included; older activity may require loading.'
        : 'Activity discovery is unavailable for this network.',
    });
  }
  private hydrate(hash?: string, page?: SavedPendingPage) {
    if (hash && (!this.checking.has(hash) || this.checking.get(hash)?.page !== page) &&
        !this.hydration.some((request) => request.hash === hash && request.page === page))
      this.hydration.push({ hash, page });
    while (
      this.workers < 2 &&
      this.hydration.length &&
      this.scope &&
      this.request
    ) {
      const detail = this.hydration.shift()!;
      const { hash, page } = detail;
      if (page && page !== this.savedPending) continue;
      const scope = this.scope,
        signal = page?.lifetime.signal ?? this.request.signal,
        runtime = this.runtime(),
        generation = this.generation,
        revision = this.source.getSnapshot().revision;
      if (signal.aborted) continue;
      const guard = () => {
        this.guard(generation, revision, signal);
        if (this.checking.get(hash) !== detail ||
            (page && (this.savedPending !== page || this.runtime() !== runtime)))
          throw new ActivityError('CANCELLED');
      };
      this.workers++;
      this.checking.set(hash, detail);
      const readDetail = async () => {
        guard();
        const local = page?.records.get(hash) ?? this.locals.get(hash);
        if (local && (local.smartAccount || !this.locals.has(hash))) {
          if (!runtime?.observeLocal) throw new ActivityError('UNAVAILABLE');
          // The signed record already supplies the envelope. Use one owned
          // observation for status, without fetching the same receipt again.
          const observation = await runtime.observeLocal(local, guard, signal);
          guard();
          this.retainedObservations.set(hash, observation);
          return;
        }
        const observation = await this.receipts.read(hash, scope.address, signal, guard, scope.network);
        guard();
        if (observation)
          this.observations.set(hash, {
            ...observation,
            events: observation.events.map((event) => ({
              ...event,
              id: `${scope.key}:${event.id}`,
            })),
          });
        else this.unavailable.add(hash);
      };
      void readDetail()
        .catch(() => {
          try { guard(); } catch { return; }
          this.unavailable.add(hash);
        })
        .finally(() => {
          this.workers--;
          if (generation === this.generation && this.checking.get(hash) === detail) {
            this.checking.delete(hash);
            this.renderRows();
          }
          this.hydrate();
        });
    }
  }
  inspect(hash: string) {
    const page = this.savedPending?.records.has(hash) ? this.savedPending : undefined;
    if (page || this.snapshot.rows.some((row) => row.hash === hash)) {
      this.observations.delete(hash);
      this.unavailable.delete(hash);
      if ((page && !this.locals.has(hash)) || this.locals.get(hash)?.smartAccount) this.retainedObservations.delete(hash);
      this.hydrate(hash, page);
      if (page) this.renderRows();
    }
  }
  private observeRetained() {
    const runtime = this.runtime(),
      scope = this.scope,
      request = this.request;
    if (!runtime?.observeLocal || !scope || !request) return;
    const generation = this.generation,
      revision = this.source.getSnapshot().revision;
    const guard = () => this.guard(generation, revision);
    // Only retained unresolved local submissions use the existing shared observer.
    // Indexed list rows never trigger transaction/receipt/block RPC requests.
    const queue = [...this.locals.values()].filter((local) =>
      ['signed', 'attempted', 'submitted'].includes(local.phase)
    );
    const run = async () => {
      while (queue.length && !request.signal.aborted) {
        const local = queue.shift()!;
        try {
          guard();
          const observation = await runtime.observeLocal!(
            local,
            guard,
            request.signal
          );
          guard();
          this.retainedObservations.set(local.hash, observation);
        } catch {
          /* A read failure does not discard a retained transaction. */
        }
        if (generation === this.generation) this.renderRows();
      }
    };
    void run();
    void run();
  }

  async setView(update: Partial<ActivityViewState>): Promise<void> {
    const next = Object.freeze({ ...this.snapshot.view, ...update });
    this.publish({ view: next });
    const scope = this.scope,
      generation = this.generation,
      revision = this.source.getSnapshot().revision;
    if (scope)
      await this.runtime()
        ?.saveView(scope, next, () => this.guard(generation, revision))
        .catch(() => {
          if (generation === this.generation)
            this.publish({
              error:
                'Activity position could not be saved. Your transactions are unaffected.',
            });
        });
  }
}
