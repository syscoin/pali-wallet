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
  EVM_ACTIVITY_CURSOR_STALE,
  EVM_TRANSACTION_HISTORY_SOURCE,
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
import { getObservedEvmTerminalPhase, type EvmObservationRequest, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import type { SmartAccountAuthorizationSummary } from '../../../../source/wallet/smartAccountAuthorization.ts';
import type { SmartAccountAuthorizationObservation } from '../../../../source/utils/smartAccount/authorizationStatus.ts';
import type { NativeTokenPortfolioScope } from '../portfolio/tokenRegistry.ts';
import { nativeLocalReplacementStatuses, nativeLocalReplacementWinnersToObserve } from './localReplacementStatus.ts';

type SmartAuthorizationPage = Readonly<{
  entries: readonly SmartAccountAuthorizationSummary[];
  nextCursor: string | null;
  withOuterOperationHashes?: readonly string[];
}>;
type SavedActivityPage = Readonly<{
  records: readonly LocalActivityRecord[];
  nextCursor: string | null;
}>;
type ActivityAuthorization = Readonly<{
  instruction: SmartAccountAuthorizationSummary;
  observation?: SmartAccountAuthorizationObservation;
  checking: boolean;
  unavailable: boolean;
  hasOuter?: true;
}>;
export const activityRowTimestamp = (row: ActivityRow) =>
  row.observation?.timestamp ?? row.candidate?.timestamp ?? row.local?.createdAt ??
  (row.indexed?.historySource === EVM_TRANSACTION_HISTORY_SOURCE.ExplorerPending ? row.indexed.timestamp * 1000 : undefined) ??
  (row.authorizationOnly ? row.smartAuthorizations?.[0]?.instruction.createdAt : undefined) ?? 0;

const operationRowKey = (hash: string) => `operation:${hash}`;
export const activityRowKey = (row: ActivityRow) =>
  row.authorizationOnly ? operationRowKey(row.hash) : row.hash;

export function findActivityRow(rows: readonly ActivityRow[], target: string) {
  return rows.find(row => activityRowKey(row) === target) ?? rows.find(row =>
    row.smartAuthorizations?.some(({ instruction: { operationHash } }) =>
      operationHash === target || operationRowKey(operationHash) === target));
}

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
    smartAuthorizations?: SmartAuthorizationPage;
    olderRetained?: boolean;
  }>;
  loadSmartAuthorizations?(scope: EvmActivityReadScope, beforeHash: string | undefined, guard: () => void): Promise<SmartAuthorizationPage>;
  observeSmartAuthorization?(scope: EvmActivityReadScope, operationHash: string, guard: () => void, signal: AbortSignal): Promise<SmartAccountAuthorizationObservation>;
  loadTarget?(scope: EvmActivityReadScope, hash: string, guard: () => void): Promise<Readonly<{
    local?: LocalActivityRecord;
    authorization?: SmartAccountAuthorizationSummary;
    hasOuter?: true;
  }> | null>;
  loadSavedPending?(
    scope: EvmActivityReadScope,
    beforeHash: string | undefined,
    guard: () => void
  ): Promise<SavedActivityPage>;
  observeLocal?(
    record: LocalActivityRecord,
    guard: () => void,
    signal: AbortSignal,
    observe?: (request: EvmObservationRequest) => Promise<EvmTransactionObservation>,
    presentationOnly?: boolean
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
  /** The hash identifies an authenticated operation, with no transaction row. */
  authorizationOnly?: true;
  smartAuthorizations?: readonly ActivityAuthorization[];
  mayHaveOlderAuthorization?: true;
  local?: LocalActivityRecord;
  candidate?: ActivityCandidate;
  observation?: ActivityTransactionObservation;
  indexed?: IndexedActivityTransaction;
  display?: EvmTransactionDisplayInfo;
  indexedStatus?: EvmSettlementStatus;
  zeroValueToken?: boolean;
  retainedObservation?: EvmTransactionObservation;
  orphanedPlacement?: true;
  /** Current, scope-bound canonical sibling evidence; never persisted. */
  replacementStatus?: 'replaced';
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
  error: 'load-incomplete' | 'feed-unavailable' | 'older-unavailable' | 'position-not-saved' | null;
  coverage: 'network-transfers' | 'explorer-transfers' | 'discovery-unavailable';
  truncated: boolean;
  discoveryAvailable?: boolean;
}>;
export type ActivityLifecycleSnapshot = Readonly<{
  phase: string;
  revision: number;
}>;
export type ActivityLifecycle = {
  getSnapshot(): ActivityLifecycleSnapshot;
  subscribe(listener: () => void): () => void;
};
export type ActivityExplorerPort = Pick<ActivityExplorerReader, 'page'> &
  Partial<Pick<ActivityExplorerReader, 'pending'>>;
export type ActivityReceiptPort = Pick<ActivityReceiptReader, 'read'> & Partial<Pick<ActivityReceiptReader, 'observe' | 'retainedWave' | 'blockHashAt'>>;
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
type ActivityDetailRequest = Readonly<{ hash: string }>;
type RetainedObservationWork = {
  lifetime: AbortController;
  queue: LocalActivityRecord[];
  seen: Set<string>;
  confirmedUntil: Map<string, number>;
  blockHashes: Map<string, Promise<string>>;
  workers: number;
  retry?: ReturnType<typeof setTimeout>;
};
const RECENT_SUBMISSION_MS = 5 * 60_000;
const recentlySubmitted = (local: LocalActivityRecord, now = Date.now()) =>
  local.createdAt <= now && local.createdAt + RECENT_SUBMISSION_MS > now;
const PENDING_RECEIPT_INTERVAL_MS = 15_000;
const OLDER_RECEIPT_INTERVAL_MS = 60_000;
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
    coverage: 'network-transfers',
    truncated: false,
  });

/** Account-bound read model. Neither network results nor this controller can sign. */
export class NativeActivity {
  private snapshot = initial();
  private activityError: Exclude<NativeActivitySnapshot['error'], 'position-not-saved'> = null;
  private viewSaveFailed = false;
  private viewSaveAttempt = 0;
  private listeners = new Set<() => void>();
  private connection: object | null = null;
  private scope: EvmActivityReadScope | null = null;
  private scopeRevision: number | null = null;
  private refreshingRows: ReadonlyMap<string, ActivityRow> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private visible = 20;
  private indexed = new Map<string, IndexedActivityTransaction>();
  private pendingRows: readonly ActivityRow[] = [];
  private displays = new Map<string, EvmTransactionDisplayInfo>();
  private tokenEvents = new Map<string, Readonly<Record<string, unknown>>>();
  private assets: readonly EvmDisplayTokenMetadata[] = [];
  private orphanedPlacements = new Set<string>();
  private retainedObservations = new Map<string, EvmTransactionObservation>();
  private retainedWork?: RetainedObservationWork;
  private cachedFallback = false;
  private candidates = new Map<string, ActivityCandidate>();
  private freshCandidates = new Set<string>();
  private smartAuthorizations = new Map<string, ActivityAuthorization>();
  private authorizationCursor: string | null | undefined = null;
  private absentAuthorizations = new Set<string>();
  private journalLifetime = new AbortController();
  private locals = new Map<string, LocalActivityRecord>();
  private pendingCursor: string | null | undefined;
  private pagedLocals = new Set<string>();
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
    if (update.error !== undefined && update.error !== 'position-not-saved')
      this.activityError = update.error;
    this.snapshot = Object.freeze({ ...this.snapshot, ...update,
      error: this.viewSaveFailed ? 'position-not-saved' : this.activityError });
    for (const listener of this.listeners) listener();
  }
  connect(): () => void {
    const connection = {};
    this.connection = connection;
    let revision = -1;
    const update = () => {
      if (this.connection !== connection) return;
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
      if (this.connection !== connection) return;
      this.connection = null;
      this.stop();
      this.publish(initial());
    };
  }
  private stop() {
    this.generation++;
    this.activityError = null;
    this.viewSaveFailed = false;
    this.request?.abort();
    this.journalLifetime.abort();
    this.journalLifetime = new AbortController();
    this.request = null;
    this.scope = null;
    this.scopeRevision = null;
    this.refreshingRows = null;
    this.pendingRows = [];
    this.pendingCursor = undefined;
    this.pagedLocals.clear();
    if (this.retainedWork) {
      clearTimeout(this.retainedWork.retry);
      this.retainedWork.lifetime.abort();
    }
    this.retainedWork = undefined;
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
      this.source.getSnapshot().phase !== 'ready' ||
      this.source.getSnapshot().revision !== revision
    )
      throw new ActivityError('CANCELLED');
  }
  private reset(): void {
    this.stop();
    this.candidates.clear();
    this.freshCandidates.clear();
    this.locals.clear();
    this.smartAuthorizations.clear();
    this.absentAuthorizations.clear();
    this.authorizationCursor = null;
    this.observations.clear();
    this.unavailable.clear();
    this.visible = 20;
    this.feeds = { txlist: this.feed(), tokentx: this.feed() };
    this.tokenEvents.clear();
    this.indexed.clear();
    this.displays.clear();
    this.retainedObservations.clear();
    this.orphanedPlacements.clear();
    this.assets = [];
    this.cachedFallback = true;
  }
  invalidate(): void {
    this.reset();
    this.publish(initial());
  }
  async refresh(): Promise<void> {
    const state = this.source.getSnapshot();
    const previousScope = this.scope;
    const previous = state.phase === 'ready' && state.revision === this.scopeRevision
      ? this.snapshot : null;
    const previousOrphans = previous ? [...this.orphanedPlacements] : [];
    this.reset();
    const previousTransactions = previous?.rows.filter(row =>
      !row.authorizationOnly && row.indexed?.historySource !== EVM_TRANSACTION_HISTORY_SOURCE.ExplorerPending
    ) ?? [];
    this.refreshingRows = previous && new Map(previousTransactions.map(row => [row.hash, row]));
    const generation = this.generation;
    const revision = state.revision;
    this.request = new AbortController();
    const signal = this.request.signal;
    const guard = () => this.guard(generation, revision);
    this.publish({ ...(previous ?? initial()),
      rows: previousTransactions.map(row => {
        if (!row.smartAuthorizations && !row.replacementStatus) return row;
        return { ...row, smartAuthorizations: undefined, replacementStatus: undefined };
      }),
      status: 'loading', loadingMore: false, error: null });
    try {
      const runtime = this.runtime();
      if (!runtime) throw new ActivityError('UNAVAILABLE');
      const { scope, saved, locals, assets, smartAuthorizations, olderRetained } = await runtime.load(
        guard,
        signal
      );
      guard();
      if (!previousScope || previousScope.key !== scope.key || previousScope.sourceId !== scope.sourceId ||
          previousScope.network.registrationHash !== scope.network.registrationHash)
        this.refreshingRows = null;
      else for (const hash of previousOrphans) this.orphanedPlacements.add(hash);
      this.scope = scope;
      this.pendingCursor = olderRetained && runtime.loadSavedPending ? undefined : null;
      this.scopeRevision = revision;
      this.assets = assets ?? [];
      if (smartAuthorizations) this.applySmartAuthorizationPage(smartAuthorizations);
      for (const record of saved.archived) this.locals.set(record.hash, record);
      for (const local of locals) this.locals.set(local.hash, local);
      for (const record of saved.candidates)
        this.candidates.set(record.hash, record);
      this.publish({
        status: this.refreshingRows ? 'loading' : 'ready',
        rows: this.refreshingRows ? this.snapshot.rows : [],
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

      });
      this.renderRows(true);
      this.observeRetained();
      if (!scope.apiUrl) {
        this.feeds.txlist.done = true;
        this.feeds.tokentx.done = true;
        this.refreshingRows = null;
        this.renderRows(true);
        this.publish({
          coverage: 'discovery-unavailable',
          status: 'ready',
        });
        return;
      }
      // Each admitted explorer response owns its 12-second HTTP/body deadline;
      // fill caps six reads. Account-wide queue wait must not consume that time.
      await this.fill(guard, signal);
      guard();
      await runtime.saveCache(
        scope,
        this.orderedCandidates().slice(0, 24).map(activityCandidateSummary),
        guard
      );
      guard();
      this.cachedFallback = false;
      this.refreshingRows = null;
      this.renderRows();
      this.publish({ status: 'ready' });
      void this.discoverPending(scope, signal, guard);
    } catch {
      if (generation !== this.generation) return;
      this.refreshingRows = null;
      this.cachedFallback = true;
      this.publish({
        status: this.scope ? 'ready' : 'unavailable',
        error: 'load-incomplete',
        loadingMore: false,
      });
      this.renderRows(true);
    }
  }
  private async discoverPending(
    scope: EvmActivityReadScope, signal: AbortSignal, guard: () => void
  ) {
    if (!this.explorer.pending) return;
    try {
      guard();
      const pending = await this.explorer.pending(scope, signal, guard);
      guard();
      if (!pending.length) return;
      const assets = this.assets;
      const rows = await Promise.all(pending.map(async (indexed): Promise<ActivityRow> => ({
        hash: indexed.hash,
        indexed,
        display: await getEvmTransactionDisplayInfo(indexed, scope.network.symbol, {
          chainId: Number(scope.network.chainId), assets,
        }).catch(() => undefined),
        indexedStatus: 'pending',
        checking: false,
        unavailable: false,
      })));
      guard();
      this.pendingRows = rows;
      this.renderRows();
    } catch {
      // Optional reads never affect confirmed history or publish after retirement.
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
          rows.map((row) => JSON.stringify([
            row.hash,
            row.blockNumber,
            row.tokenEvent?.logIndex,
            row.indexed.tokenTransfer,
          ])).sort()
        );
        if (rows.length === ACTIVITY_PAGE_SIZE && fingerprint === feed.fingerprint)
          throw new Error('Explorer page did not advance');
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
        for (const row of rows) this.freshCandidates.add(row.hash);
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
          error: 'feed-unavailable',
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
    const scope = this.scope, request = this.request, runtime = this.runtime();
    if (this.snapshot.loadingMore || !scope || !request) return;
    const generation = this.generation, revision = this.source.getSnapshot().revision;
    const journalSignal = this.journalLifetime.signal;
    const journalGuard = () => {
      this.guard(generation, revision, journalSignal);
      if (this.scope !== scope || this.runtime() !== runtime) throw new ActivityError('CANCELLED');
    };
    const readJournalPage = async <T extends { nextCursor: string | null }>(
      cursor: string | undefined,
      read: (beforeHash: string | undefined) => Promise<T>,
      invalidate: (hash: string) => boolean
    ): Promise<T> => {
      let page: T;
      try {
        page = await read(cursor);
      } catch (error) {
        if (cursor === undefined || !(error instanceof Error) || error.message !== EVM_ACTIVITY_CURSOR_STALE)
          throw error;
        journalGuard();
        const canRebase = invalidate(cursor);
        this.renderRows();
        if (!canRebase) throw error;
        page = await read(undefined);
      }
      journalGuard();
      if (page.nextCursor !== null && page.nextCursor === cursor) throw new ActivityError('INVALID');
      return page;
    };
    try {
      if (this.authorizationCursor !== null && runtime?.loadSmartAuthorizations) {
        this.publish({ loadingMore: true });
        const page = await readJournalPage(
          this.authorizationCursor,
          cursor => runtime.loadSmartAuthorizations!(scope, cursor, journalGuard),
          stale => {
            this.authorizationCursor = undefined;
            this.smartAuthorizations.delete(stale);
            return true;
          }
        );
        this.applySmartAuthorizationPage(page);
        if (this.activityError === 'older-unavailable') this.publish({ error: null });
        this.renderRows();
        if (this.pendingCursor === null && Object.values(this.feeds).every(feed => feed.done) &&
            this.orderedCandidates().length <= this.visible) return;
      }
      if (this.pendingCursor !== null && runtime?.loadSavedPending) {
        this.publish({ loadingMore: true });
        let added = 0, rebased = false;
        // The recent local window already covers the first two pending pages.
        // Skip overlapping pages until this request reveals another row.
        for (let attempt = 0; attempt < 3 && this.pendingCursor !== null && !added; attempt++) {
          const cursor: string | undefined = this.pendingCursor;
          const page: SavedActivityPage = await readJournalPage(
            cursor,
            beforeHash => runtime.loadSavedPending!(scope, beforeHash, journalGuard),
            stale => {
              this.pendingCursor = undefined;
              this.locals.delete(stale);
              this.pagedLocals.delete(stale);
              this.retainedObservations.delete(stale);
              this.orphanedPlacements.delete(stale);
              const canRebase = !rebased;
              rebased = true;
              return canRebase;
            }
          );
          this.pendingCursor = page.nextCursor;
          for (const local of page.records) {
            if (this.locals.has(local.hash)) continue;
            this.locals.set(local.hash, local);
            this.pagedLocals.add(local.hash);
            added++;
          }
        }
        if (this.activityError === 'older-unavailable') this.publish({ error: null });
        this.renderRows();
        this.observeRetained();
        if (added || this.pendingCursor !== null) return;
      }
      if (this.visible >= 200 && this.orderedCandidates().length >= this.visible) return;
      if (request.signal.aborted) { await this.refresh(); return; }
      if (this.orderedCandidates().length >= this.visible)
        this.visible = Math.min(200, this.visible + 20);
      const guard = () => this.guard(generation, revision);
      for (const feed of Object.values(this.feeds)) feed.error = false;
      await this.fill(guard, request.signal);
      guard();
      await runtime?.saveCache(scope, this.orderedCandidates().slice(0, 24).map(activityCandidateSummary), guard);
    } catch {
      if (generation === this.generation) this.publish({ error: 'older-unavailable' });
    } finally {
      if (generation === this.generation) this.publish({ loadingMore: false });
    }
  }
  async loadTarget(hash: string): Promise<void> {
    const scope = this.scope, runtime = this.runtime();
    if (!scope || !runtime?.loadTarget) return;
    const generation = this.generation, revision = this.source.getSnapshot().revision;
    const signal = this.journalLifetime.signal;
    const guard = () => {
      this.guard(generation, revision, signal);
      if (this.scope !== scope || this.runtime() !== runtime) throw new ActivityError('CANCELLED');
    };
    const target = await runtime.loadTarget(scope, hash, guard);
    guard();
    if (!target) return;
    if (target.local && target.local.hash !== hash || target.authorization && target.authorization.operationHash !== hash)
      throw new ActivityError('INVALID');
    if (target.local && !this.locals.has(hash)) {
      this.locals.set(hash, target.local);
      this.pagedLocals.add(hash);
    }
    if (target.authorization && !this.smartAuthorizations.has(hash))
      this.smartAuthorizations.set(hash, { instruction: target.authorization, checking: false, unavailable: false,
        ...(target.hasOuter ? { hasOuter: true } : {}) });
    this.renderRows();
    this.observeRetained();
  }
  private applySmartAuthorizationPage(page: SmartAuthorizationPage) {
    const withOuter = new Set(page.withOuterOperationHashes);
    for (const instruction of page.entries) {
      if (!this.smartAuthorizations.has(instruction.operationHash))
        this.smartAuthorizations.set(instruction.operationHash, { instruction, checking: false, unavailable: false,
          ...(withOuter.has(instruction.operationHash) ? { hasOuter: true } : {}) });
    }
    this.authorizationCursor = page.nextCursor;
  }
  async inspectSmartAuthorization(hash: string, assertView: () => void, viewSignal: AbortSignal) {
    const scope = this.scope, runtime = this.runtime();
    let existing = this.smartAuthorizations.get(hash);
    if (!scope || !runtime?.observeSmartAuthorization || existing?.checking ||
        (!existing && (this.authorizationCursor === null || !runtime.loadTarget || this.absentAuthorizations.has(hash)))) return;
    const generation = this.generation, revision = this.source.getSnapshot().revision;
    const lifetime = this.journalLifetime;
    const request = new AbortController(), abort = () => request.abort();
    if (viewSignal.aborted || lifetime.signal.aborted) return;
    lifetime.signal.addEventListener('abort', abort, { once: true });
    viewSignal.addEventListener('abort', abort, { once: true });
    let checking: ActivityAuthorization | undefined;
    const guard = () => {
      this.guard(generation, revision, request.signal);
      if (this.scope !== scope || this.runtime() !== runtime ||
          checking && this.smartAuthorizations.get(hash) !== checking) throw new ActivityError('CANCELLED');
      assertView();
    };
    try {
      guard();
      if (!existing) {
        // An opened older outer needs only its own operation, even when the list
        // has several unvisited authorization pages.
        const target = await runtime.loadTarget!(scope, hash, guard);
        guard();
        existing = this.smartAuthorizations.get(hash);
        if (!existing) {
          if (!target?.authorization) {
            this.absentAuthorizations.add(hash);
            return;
          }
          if (target.authorization.operationHash !== hash) throw new ActivityError('INVALID');
          existing = { instruction: target.authorization, checking: false, unavailable: false,
            ...(target.hasOuter ? { hasOuter: true } : {}) };
        }
      }
      checking = { ...existing, checking: true };
      this.smartAuthorizations.set(hash, checking);
      this.renderRows();
      const observation = await runtime.observeSmartAuthorization(scope, hash, guard, request.signal);
      guard();
      if (observation.operationHash !== hash) throw new ActivityError('INVALID');
      this.smartAuthorizations.set(hash, { ...existing, observation, unavailable: false });
    } catch {
      try {
        guard();
        if (existing) this.smartAuthorizations.set(hash, { ...existing, unavailable: true });
      } catch { /* Revoked views publish no status. */ }
    } finally {
      request.abort();
      lifetime.signal.removeEventListener('abort', abort);
      viewSignal.removeEventListener('abort', abort);
      if (generation === this.generation && existing && checking && this.smartAuthorizations.get(hash) === checking)
        this.smartAuthorizations.set(hash, existing);
      if (generation === this.generation) this.renderRows();
    }
  }
  private renderRows(includeCached = this.cachedFallback) {
    const records = new Map<string, ActivityRow>([...(this.refreshingRows ?? [])]
      .map(([hash, row]) => [hash, { ...row, smartAuthorizations: undefined }]));
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
      const previous = includeIndex ? this.refreshingRows?.get(row.hash) : undefined;
      // Presentation only: a healthy same-scope refresh need not erase its last
      // display while hash-only cache hints load. Fresh facts always replace it.
      if (previous && !this.freshCandidates.has(row.hash) && !this.observations.has(row.hash) &&
          !this.retainedObservations.has(row.hash) && !this.orphanedPlacements.has(row.hash) && !this.unavailable.has(row.hash) &&
          JSON.stringify(row.local) === JSON.stringify(previous.local))
        return { ...previous, ...(previous.smartAuthorizations ? { smartAuthorizations: undefined } : {}), checking: this.checking.has(row.hash) };
      // An indexer describes the outer payer transaction; this row represents its verified inner operation.
      if (row.local?.smartAccount || this.pagedLocals.has(row.hash)) includeIndex = false;
      const indexed = includeIndex ? this.indexed.get(row.hash) : undefined;
      const display = includeIndex ? this.displays.get(row.hash) : undefined;
      return {
        ...row,
        observation: row.local?.smartAccount ? undefined : this.observations.get(row.hash),
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
        ...(this.orphanedPlacements.has(row.hash) ? { orphanedPlacement: true as const } : {}),
        checking: this.checking.has(row.hash),
        unavailable: this.unavailable.has(row.hash),
      };
    };
    const observedRows = [...records.values()].map((row) => observeRow(row));
    // Previous rows may preserve a display during refresh, but cannot supply
    // fresh sibling proof. Use only observations owned by this generation.
    const replacements = this.scope ? nativeLocalReplacementStatuses(
      observedRows.map(row => ({ ...row,
        observation: row.local?.smartAccount ? undefined : this.observations.get(row.hash),
        retainedObservation: this.retainedObservations.get(row.hash),
      })), this.scope) : new Map<string, 'replaced'>();
    const withReplacement = (row: ActivityRow): ActivityRow => ({ ...row,
      replacementStatus: replacements.get(row.hash),
    });
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
    // Speed-ups of an outer can carry the same instruction. Its nonce status
    // belongs on every carrying transaction, including older attempts.
    const carried = new Set<string>();
    const rows = [...retained.values()].map(row => {
      const smart = row.local?.smartAccount;
      const operations = smart && !smart.cancellation ? smart.operations : [];
      const authorizations = operations.flatMap(operation => {
        carried.add(operation.operationHash);
        const authorization = this.smartAuthorizations.get(operation.operationHash);
        return authorization ? [authorization] : [];
      });
      const hash = operations.length === 1 ? operations[0]!.operationHash : undefined;
      const mayHaveOlder = this.authorizationCursor !== null && hash && !row.local?.cancellationUnavailable &&
        !authorizations.length && !this.absentAuthorizations.has(hash);
      return withReplacement({ ...row, smartAuthorizations: authorizations.length ? authorizations : undefined,
        mayHaveOlderAuthorization: mayHaveOlder ? true : undefined });
    });
    const byHash = new Map(rows.map(row => [row.hash, row]));
    // Pending explorer rows are presentation only. Keep them out of the
    // block frontier, persisted candidates and nonce/replacement projections.
    for (const row of this.pendingRows) {
      if (records.has(row.hash) || this.indexed.has(row.hash) || byHash.has(row.hash)) continue;
      byHash.set(row.hash, {
        ...row,
        observation: this.observations.get(row.hash),
        checking: this.checking.has(row.hash),
        unavailable: this.unavailable.has(row.hash),
      });
    }
    const authorizationRows: ActivityRow[] = [];
    for (const [hash, authorization] of this.smartAuthorizations) {
      if (carried.has(hash)) continue;
      const row = authorization.observation?.kind === 'observed'
        ? byHash.get(authorization.observation.transactionHash) : undefined;
      if (row) {
        byHash.set(row.hash, { ...row, smartAuthorizations: [...(row.smartAuthorizations ?? []), authorization] });
      } else if (!authorization.hasOuter && !authorization.instruction.replacesOperationHash) {
        authorizationRows.push({ hash, authorizationOnly: true, smartAuthorizations: [authorization],
          checking: authorization.checking, unavailable: authorization.unavailable });
      }
    }
    const moreToLoad = Object.values(this.feeds).some((f) => !f.done);
    const atDisplayLimit = this.visible >= 200 && candidates.length >= 200;
    this.publish({
      rows: [...byHash.values(), ...authorizationRows].sort((a, b) => activityRowTimestamp(b) - activityRowTimestamp(a)),
      hasMore:
        this.authorizationCursor !== null && !!this.runtime()?.loadSmartAuthorizations ||
        this.pendingCursor !== null && !!this.runtime()?.loadSavedPending || !atDisplayLimit && (candidates.length > this.visible || moreToLoad),
      truncated:
        this.snapshot.truncated ||
        (atDisplayLimit && (candidates.length > this.visible || moreToLoad)),
      coverage: this.scope?.apiUrl
        ? 'explorer-transfers'
        : 'discovery-unavailable',
    });
  }
  private receiptScope(scope: EvmActivityReadScope, generation: number) {
    return JSON.stringify([generation, scope.key, scope.sourceId, scope.address]);
  }
  private retainedObserver(scope: EvmActivityReadScope, generation: number, signal: AbortSignal, guard: () => void) {
    return this.receipts.observe ? (request: EvmObservationRequest) => this.receipts.observe!(
      request, signal, guard, scope.network, this.receiptScope(scope, generation)) : undefined;
  }
  private invalidatePlacement(hash: string) {
    this.orphanedPlacements.add(hash);
    this.retainedWork?.seen.add(hash);
    this.retainedObservations.delete(hash);
    this.renderRows();
  }
  private acceptObservation(hash: string, observation: EvmTransactionObservation) {
    this.retainedObservations.set(hash, observation);
    if (observation.status === 'mined' && this.orphanedPlacements.delete(hash) && observation.outcome === 'confirmed')
      this.retainedWork?.confirmedUntil.set(hash, Date.now() + RECENT_SUBMISSION_MS);
    this.unavailable.delete(hash);
  }
  private hydrate(hash?: string) {
    if (hash && !this.checking.has(hash) && !this.hydration.some(request => request.hash === hash))
      this.hydration.push({ hash });
    while (
      this.workers < 2 &&
      this.hydration.length &&
      this.scope &&
      this.request
    ) {
      const detail = this.hydration.shift()!;
      const { hash } = detail;
      const scope = this.scope,
        signal = this.pagedLocals.has(hash) ? this.journalLifetime.signal : this.request.signal,
        runtime = this.runtime(),
        generation = this.generation,
        revision = this.source.getSnapshot().revision;
      if (signal.aborted) continue;
      const smartDetail = !!this.locals.get(hash)?.smartAccount;
      const guard = () => {
        this.guard(generation, revision, signal);
        if (smartDetail !== !!this.locals.get(hash)?.smartAccount || this.checking.get(hash) !== detail || this.scope !== scope || this.runtime() !== runtime)
          throw new ActivityError('CANCELLED');
      };
      this.workers++;
      this.checking.set(hash, detail);
      const readDetail = async () => {
        guard();
        const local = this.locals.get(hash);
        if (local && (local.smartAccount || this.pagedLocals.has(hash))) {
          if (!runtime?.observeLocal) throw new ActivityError('UNAVAILABLE');
          const prior = this.retainedObservations.get(hash);
          if (local.smartAccount && prior?.status === 'mined' && prior.outcome === 'confirmed' && this.receipts.blockHashAt) {
            const header = await this.receipts.blockHashAt(prior.block.number, scope.network, signal, guard);
            guard();
            if (this.retainedObservations.get(hash) !== prior) return;
            if (header === prior.block.hash) {
              this.unavailable.delete(hash);
              return;
            }
            this.invalidatePlacement(hash);
          }
          const before = this.retainedObservations.get(hash);
          // The signed record already supplies the envelope. Use one owned
          // observation for status, without fetching the same receipt again.
          const observation = await runtime.observeLocal(local, guard, signal, this.retainedObserver(scope, generation, signal, guard), this.orphanedPlacements.has(hash));
          guard();
          if (this.retainedObservations.get(hash) !== before) return;
          this.acceptObservation(hash, observation);
          const operations = local.smartAccount?.operations;
          if (!local.operation && !local.cancellationRetry && operations?.length === 1 &&
              observation.status === 'mined' && observation.outcome === 'reverted' && runtime.loadTarget) {
            // An older archive retains the receipt identity but omits live review hints.
            try {
              const retained = (await runtime.loadTarget(scope, hash, guard))?.local;
              guard();
              const retainedOperations = retained?.smartAccount?.operations;
              if (retained?.hash === hash && retained.cancellationRetry && retainedOperations?.length === 1 &&
                  retainedOperations[0]!.operationHash === operations[0]!.operationHash &&
                  retainedOperations[0]!.operationNonce === operations[0]!.operationNonce && this.locals.get(hash) === local) {
                this.locals.set(hash, { ...local, cancellationRetry: retained.cancellationRetry });
              }
            } catch {
              // The receipt stays visible if the optional review hint cannot be loaded.
              guard();
            }
          }
          if (local.smartAccount || observation.status !== 'missing' ||
              BigInt(observation.latestNonce) > BigInt(local.nonce) ||
              local.transactionType !== 0 && local.transactionType !== 2) return;
        }
        const observation = await this.receipts.read(hash, scope.address, signal, guard, scope.network, this.receiptScope(scope, generation));
        guard();
        if (observation) {
          this.observations.set(hash, {
            ...observation,
            events: observation.events.map((event) => ({
              ...event,
              id: `${scope.key}:${event.id}`,
            })),
          });
          this.unavailable.delete(hash);
        } else if (!this.pagedLocals.has(hash) || !this.retainedObservations.has(hash)) this.unavailable.add(hash);
      };
      void readDetail()
        .catch(() => {
          try { guard(); } catch { return; }
          const prior = this.retainedObservations.get(hash);
          if (!(smartDetail && prior?.status === 'mined' && prior.outcome === 'confirmed'))
            this.unavailable.add(hash);
        })
        .finally(() => {
          this.workers--;
          if (generation === this.generation && this.checking.get(hash) === detail) {
            this.checking.delete(hash);
            this.renderRows();
            if (this.orphanedPlacements.has(hash)) this.observeRetained();
          }
          this.hydrate();
        });
    }
  }
  inspect(hash: string) {
    if (this.snapshot.rows.some((row) => !row.authorizationOnly && row.hash === hash)) {
      this.observations.delete(hash);
      this.unavailable.delete(hash);
      const prior = this.retainedObservations.get(hash);
      const keepPlacement = this.locals.get(hash)?.smartAccount && prior?.status === 'mined' && prior.outcome === 'confirmed';
      if (!keepPlacement && (this.pagedLocals.has(hash) || this.locals.get(hash)?.smartAccount)) this.retainedObservations.delete(hash);
      this.hydrate(hash);
      this.renderRows();
    }
  }
  private observeRetained() {
    const runtime = this.runtime(),
      scope = this.scope,
      request = this.request;
    if (!runtime?.observeLocal || !scope || !request) return;
    const generation = this.generation,
      revision = this.source.getSnapshot().revision;
    // Explorer deadlines do not retire this generation's owned journal reads.
    const work: RetainedObservationWork = this.retainedWork ??= { lifetime: new AbortController(), queue: [], seen: new Set(), confirmedUntil: new Map(), blockHashes: new Map(), workers: 0 };
    const guard = () => {
      this.guard(generation, revision, work.lifetime.signal);
      if (this.retainedWork !== work) throw new ActivityError('CANCELLED');
    };
    // Recent Smart Account confirmations may have been archived before Activity opened.
    const locals = [...this.locals.values()];
    const candidates = locals.filter((local) => this.orphanedPlacements.has(local.hash) || !this.pagedLocals.has(local.hash) &&
      (['signed', 'attempted', 'submitted'].includes(local.phase) ||
       local.smartAccount && local.phase === 'confirmed' && recentlySubmitted(local))
    );
    candidates.push(...nativeLocalReplacementWinnersToObserve(locals, scope));
    for (const local of candidates) if (!work.seen.has(local.hash)) {
      if (local.smartAccount && local.phase === 'confirmed' && recentlySubmitted(local)) {
        work.confirmedUntil.set(local.hash, local.createdAt + RECENT_SUBMISSION_MS);
      }
      work.seen.add(local.hash); work.queue.push(local);
    }
    const pending = () => [...this.locals.values()].filter(local => {
      const observation = this.retainedObservations.get(local.hash);
      const terminal = observation && getObservedEvmTerminalPhase(observation, local.nonce);
      if (terminal === 'nonce-consumed' || terminal === 'reverted') return false;
      if (this.orphanedPlacements.has(local.hash)) return true;
      if (this.pagedLocals.has(local.hash)) return false;
      if ((work.confirmedUntil.get(local.hash) ?? 0) > Date.now()) return true;
      if (local.phase !== 'attempted' && local.phase !== 'submitted' ||
          this.observations.get(local.hash)?.block) return false;
      return !terminal;
    });
    const pump = () => {
      const count = Math.min(2 - work.workers, work.queue.length);
      if (work.lifetime.signal.aborted) return;
      if (count <= 0) {
        if (work.workers || work.retry !== undefined || !this.connection) return;
        const unsettled = pending();
        if (!unsettled.length) return;
        const recent = unsettled.some(local => (work.confirmedUntil.get(local.hash) ?? 0) > Date.now() ||
          Date.now() - local.createdAt < RECENT_SUBMISSION_MS);
        // Keep the history and its pagination while checking these scoped receipts.
        work.retry = setTimeout(() => {
          work.retry = undefined;
          try { guard(); } catch { return; }
          if (work.workers || work.queue.length) return;
          work.blockHashes.clear();
          work.queue.push(...pending().filter(local => !this.checking.has(local.hash)));
          pump();
        }, recent ? PENDING_RECEIPT_INTERVAL_MS : OLDER_RECEIPT_INTERVAL_MS);
        return;
      }
      const lifetime = work.lifetime.signal;
      const wave = count > 1
        ? this.receipts.retainedWave?.(scope.network, this.receiptScope(scope, generation), lifetime, guard)
        : undefined;
      const observe = wave?.observe ?? this.retainedObserver(scope, generation, lifetime, guard);
      let remaining = count;
      const run = async (local: LocalActivityRecord) => {
        try {
          guard();
          const prior = this.retainedObservations.get(local.hash);
          if (local.smartAccount && prior?.status === 'mined' && work.confirmedUntil.has(local.hash)) {
            // An unchanged placement already proves the operation. An unavailable
            // header leaves its prior evidence intact, even if the receipt index lags.
            if (!this.receipts.blockHashAt) return;
            const height = prior.block.number;
            let header = work.blockHashes.get(height);
            if (!header) {
              header = this.receipts.blockHashAt(height, scope.network, lifetime, guard);
              work.blockHashes.set(height, header);
            }
            const currentHash = await header;
            guard();
            if (currentHash === prior.block.hash || this.retainedObservations.get(local.hash) !== prior) return;
            this.invalidatePlacement(local.hash);
          }
          const before = this.retainedObservations.get(local.hash);
          const observation = await runtime.observeLocal!(local, guard, lifetime, observe, this.orphanedPlacements.has(local.hash));
          guard();
          if (this.retainedObservations.get(local.hash) !== before) return;
          if (local.smartAccount) {
            const phase = getObservedEvmTerminalPhase(observation, local.nonce);
            if (phase === 'confirmed' && !work.confirmedUntil.has(local.hash) &&
                (recentlySubmitted(local) ||
                 this.retainedObservations.get(local.hash)?.status === 'missing')) {
              work.confirmedUntil.set(local.hash, Date.now() + RECENT_SUBMISSION_MS);
            } else if (phase === 'reverted' || phase === 'nonce-consumed') {
              work.confirmedUntil.delete(local.hash);
            }
          }
          this.acceptObservation(local.hash, observation);
        } catch {
          try { guard(); } catch { return; }
          // A concurrent successful detail read still owns its current evidence.
          if (!this.observations.has(local.hash) && !this.retainedObservations.has(local.hash))
            this.unavailable.add(local.hash);
        }
        if (generation === this.generation) this.renderRows();
      };
      work.workers += count;
      for (const local of work.queue.splice(0, count)) {
        void run(local).finally(() => {
          work.workers--;
          if (--remaining === 0) wave?.close();
          pump();
        });
      }
    };
    pump();
  }

  async setView(update: Partial<ActivityViewState>): Promise<void> {
    const scope = this.scope,
      generation = this.generation,
      revision = this.source.getSnapshot().revision,
      runtime = scope ? this.runtime() : undefined,
      attempt = ++this.viewSaveAttempt;
    const next = Object.freeze({ ...this.snapshot.view, ...update });
    this.publish({ view: next });
    if (!scope || !runtime) return;
    const guard = () => this.guard(generation, revision);
    try {
      guard();
      await runtime.saveView(scope, next, guard);
      guard();
      if (attempt !== this.viewSaveAttempt || !this.viewSaveFailed) return;
      // A full current view supersedes prior save failures, independently of
      // the feed/older-page warning that may have arrived while writing.
      this.viewSaveFailed = false;
      this.publish({});
    } catch {
      try { guard(); } catch { return; }
      if (attempt !== this.viewSaveAttempt) return;
      this.viewSaveFailed = true;
      this.publish({});
    }
  }
}
