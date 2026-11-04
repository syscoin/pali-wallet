import type { CustodySnapshot } from '../custody/types.ts';
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
  type ActivityScope,
  type ActivityViewState,
  type LocalActivityRecord,
} from './types.ts';
import type { ActivityHistorySnapshot } from './historyStore.ts';

export interface NativeActivityRuntime {
  load(guard: () => void): Promise<{
    scope: ActivityScope;
    saved: ActivityHistorySnapshot;
    local: LocalActivityRecord | null;
  }>;
  saveCache(
    scope: ActivityScope,
    candidates: readonly ActivityCandidate[],
    guard: () => void
  ): Promise<void>;
  saveView(
    scope: ActivityScope,
    view: ActivityViewState,
    guard: () => void
  ): Promise<void>;
}
export type ActivityRow = Readonly<{
  hash: string;
  local?: LocalActivityRecord;
  candidate?: ActivityCandidate;
  observation?: ActivityTransactionObservation;
  checking: boolean;
  unavailable: boolean;
}>;
export type NativeActivitySnapshot = Readonly<{
  status: 'locked' | 'loading' | 'ready' | 'unavailable';
  rows: readonly ActivityRow[];
  view: ActivityViewState;
  accountAddress: string | null;
  explorerUrl: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  coverage: string;
  truncated: boolean;
}>;
type Source = {
  getSnapshot(): CustodySnapshot;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
};
type FeedState = {
  page: number;
  done: boolean;
  frontier: bigint | null;
  fingerprint: string | null;
  error: boolean;
};
const initial = (): NativeActivitySnapshot =>
  Object.freeze({
    status: 'locked',
    rows: [],
    view: DEFAULT_ACTIVITY_VIEW,
    accountAddress: null,
    explorerUrl: null,
    loadingMore: false,
    hasMore: false,
    error: null,
    coverage:
      'Only direct Ethereum transactions and ERC20 transfer events are included.',
    truncated: false,
  });

/** Account-bound read model. Neither network results nor this controller can sign. */
export class NativeActivity {
  private snapshot = initial();
  private listeners = new Set<() => void>();
  private scope: ActivityScope | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private visible = 20;
  private endblock: string | null = null;
  private cachedFallback = false;
  private candidates = new Map<string, ActivityCandidate>();
  private freshCandidates = new Set<string>();
  private locals = new Map<string, LocalActivityRecord>();
  private observations = new Map<string, ActivityTransactionObservation>();
  private unavailable = new Set<string>();
  private checking = new Set<string>();
  private feeds: Record<ActivityFeed, FeedState> = {
    txlist: this.feed(),
    tokentx: this.feed(),
  };
  private hydration: string[] = [];
  private workers = 0;
  private readonly source: Source;
  private readonly runtime: () => NativeActivityRuntime | undefined;
  private readonly explorer: ActivityExplorerReader;
  private readonly receipts: ActivityReceiptReader;
  constructor(
    source: Source,
    runtime: () => NativeActivityRuntime | undefined,
    explorer = new ActivityExplorerReader(),
    receipts = new ActivityReceiptReader()
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
      if (state.phase !== 'ready') {
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
    this.hydration = [];
    this.checking.clear();
  }
  private guard(generation: number, revision: number) {
    if (
      generation !== this.generation ||
      this.request?.signal.aborted ||
      this.source.getSnapshot().phase !== 'ready' ||
      this.source.getSnapshot().revision !== revision
    )
      throw new ActivityError('CANCELLED');
  }
  async refresh(): Promise<void> {
    this.stop();
    const generation = this.generation;
    const revision = this.source.getSnapshot().revision;
    this.request = new AbortController();
    const signal = this.request.signal;
    const guard = () => this.guard(generation, revision);
    this.candidates.clear();
    this.freshCandidates.clear();
    this.locals.clear();
    this.observations.clear();
    this.unavailable.clear();
    this.visible = 20;
    this.feeds = { txlist: this.feed(), tokentx: this.feed() };
    this.endblock = null;
    this.cachedFallback = true;
    this.publish({ ...initial(), status: 'loading' });
    try {
      const runtime = this.runtime();
      if (!runtime) throw new ActivityError('UNAVAILABLE');
      const { scope, saved, local } = await runtime.load(guard);
      guard();
      this.scope = scope;
      for (const record of saved.archived) this.locals.set(record.hash, record);
      if (local) this.locals.set(local.hash, local);
      for (const record of saved.candidates)
        this.candidates.set(record.hash, record);
      this.publish({
        status: 'ready',
        view: saved.view,
        accountAddress: scope.address,
        explorerUrl: scope.explorerUrl,
        truncated: saved.truncated,
      });
      this.renderRows(true);
      const timeout = setTimeout(() => {
        if (generation === this.generation) this.request?.abort();
      }, 30000);
      try {
        this.endblock = await this.explorer.head(scope, signal, guard);
        guard();
        await this.fill(guard, signal);
        guard();
        await runtime.saveCache(
          scope,
          this.orderedCandidates().slice(0, 24),
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
          'Activity could not be fully loaded. Your saved transactions have been preserved.',
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
    if (!this.scope || this.endblock === null) return;
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
          this.endblock,
          signal,
          guard
        );
        guard();
        const fingerprint = JSON.stringify(
          rows.map((r) => [r.hash, r.blockNumber])
        );
        // tokentx does not include logIndex: distinct full pages may legitimately
        // contain only events from one hash. Bound work per action, not by these projections.
        const updates = new Map<string, ActivityCandidate>();
        for (const row of rows) {
          const old = updates.get(row.hash) ?? this.candidates.get(row.hash);
          // Persisted block hints may predate a reorg. Only discoveries from
          // this refresh must agree, including duplicate hashes in one page.
          if (
            old &&
            (updates.has(row.hash) || this.freshCandidates.has(row.hash)) &&
            old.blockNumber !== row.blockNumber
          )
            throw new ActivityError('INVALID');
          updates.set(
            row.hash,
            old ? { ...row, tokenHint: old.tokenHint || row.tokenHint } : row
          );
        }
        for (const [hash, row] of updates) {
          if (!this.candidates.has(hash) && this.candidates.size >= 240)
            continue;
          this.candidates.set(hash, row);
          this.freshCandidates.add(hash);
        }
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
    if (this.endblock === null || this.request.signal.aborted) {
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
        this.orderedCandidates().slice(0, 24),
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
    const rows = [...records.values()]
      .map((row) => ({
        ...row,
        observation: this.observations.get(row.hash),
        checking: this.checking.has(row.hash),
        unavailable: this.unavailable.has(row.hash),
      }))
      .sort(
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
    this.publish({
      rows,
      hasMore:
        !atDisplayLimit && (candidates.length > this.visible || moreToLoad),
      truncated:
        this.snapshot.truncated ||
        (atDisplayLimit && (candidates.length > this.visible || moreToLoad)),
      coverage:
        'Direct Ethereum transactions and ERC20 transfer events only. Internal ETH transfers are not included. Explorer data is checked against the RPC; older activity may require loading.',
    });
    this.hydrate(rows.slice(0, Math.min(rows.length, 20)).map((r) => r.hash));
  }
  private hydrate(hashes: readonly string[]) {
    for (const hash of hashes)
      if (
        !this.observations.has(hash) &&
        !this.unavailable.has(hash) &&
        !this.checking.has(hash) &&
        !this.hydration.includes(hash)
      )
        this.hydration.push(hash);
    while (
      this.workers < 2 &&
      this.hydration.length &&
      this.scope &&
      this.request &&
      !this.request.signal.aborted
    ) {
      const hash = this.hydration.shift()!,
        scope = this.scope,
        signal = this.request.signal,
        generation = this.generation,
        revision = this.source.getSnapshot().revision;
      const guard = () => this.guard(generation, revision);
      this.workers++;
      this.checking.add(hash);
      void this.receipts
        .read(hash, scope.address, signal, guard)
        .then((observation) => {
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
        })
        .catch(() => {
          if (generation === this.generation) this.unavailable.add(hash);
        })
        .finally(() => {
          this.workers--;
          if (generation === this.generation) {
            this.checking.delete(hash);
            this.renderRows();
          } else this.hydrate([]);
        });
    }
  }
  inspect(hash: string) {
    if (this.snapshot.rows.some((row) => row.hash === hash)) {
      this.observations.delete(hash);
      this.unavailable.delete(hash);
      this.hydrate([hash]);
    }
  }
  observeVisible(hashes: readonly string[]) {
    this.hydrate(
      hashes
        .filter((hash) => this.snapshot.rows.some((row) => row.hash === hash))
        .slice(0, 30)
    );
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
