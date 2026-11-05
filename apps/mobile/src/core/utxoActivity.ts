import { utils as syscoinUtils } from 'syscoinjs-lib';
import { createUtxoTransactionDetailsCache, UTXO_DETAIL_CACHE_BYTES } from '../../../../source/shared/utxoTransactionDetailCache.ts';
import { getSendingAddresses, getReceivingAddresses, mergeAccountSummaryWithFullTransaction, type UtxoDetailTransaction } from '../../../../source/shared/utxoTransactionDetails.ts';
import { bindUtxoDetailObservation } from '../../../../source/shared/utxoDetailFreshness.ts';
import { createBlockbookAccountHistory, readHistoryCount } from '../../../../source/shared/blockbookAccountHistory.ts';
import { mergeFreshBlockbookHistory } from '../../../../source/shared/blockbookHistoryMerge.ts';
import { selectEvmHistoryRepresentatives } from '../../../../source/shared/evmHistory.ts';
import { getTransactionBlockInfo } from '../../../../source/shared/transactionBlockStatus.ts';
import { getSyscoinAccountChange, getSyscoinNativeTransferAmount, isSyscoinTokenOperation } from '../../../../source/shared/utxoNativeAmounts.ts';
import { parseErc20Text } from '../../../../source/shared/erc20.ts';
import { getSyscoinActivityOperationAmount } from '../../../../source/shared/utxoTokenAmounts.ts';
import { assertJsonWorkBudget, measureJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { assertPublicWatchOnlyIdentifier } from '../../../../source/utils/watchOnlyIdentifier.ts';
import { assertBaseUnits } from './amounts.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { openUtxoReadSession, utxoFetchOptions, utxoObject, type UtxoFetch, type UtxoReadSession } from './utxoReadSession.ts';
import type { PublicSnapshot } from './types.ts';

export const UTXO_ACTIVITY_LIMITS = Object.freeze({ pageSize: 20, nativeIntegerDigits: 78, displayRows: 100, windowPages: 5, bytes: 1024 * 1024, nodes: 20000, timeoutMs: 30000 });
export type UtxoActivityContext = Readonly<{ accountId: string; networkId: UtxoNetworkId; address: string; generation: number }>;
export type UtxoActivityAssetAmount = Readonly<NonNullable<ReturnType<typeof getSyscoinActivityOperationAmount>>>;
export type UtxoActivityRow = Readonly<{
  txid: string; block: Readonly<{ height: number; hash: string | null; timestamp: number | null }> | null;
  observedConfirmations: number; receivedUnits: string | null; spentUnits: string | null; netUnits: string | null;
  transactionFeeUnits: string | null; hasAssetData: boolean; assetAmount: UtxoActivityAssetAmount | null;
  nativeTransfer: Readonly<NonNullable<ReturnType<typeof getSyscoinNativeTransferAmount>>> | null;
}>;
export type UtxoActivityPage = Readonly<{
  context: UtxoActivityContext; page: number; rows: readonly UtxoActivityRow[]; hasMore: boolean; emptyAccount: boolean;
}>;
/** Only the authority passes this private canonical source to its trusted reader. */
export type UtxoActivitySource = Readonly<{ context: UtxoActivityContext; identifier: string; isAccount: boolean }>;
export type UtxoActivityDetail = Readonly<{ txid: string; row: UtxoActivityRow; from: readonly string[]; to: readonly string[] }>;
export type UtxoActivityDetailCache = ReturnType<typeof createUtxoTransactionDetailsCache>;
export interface UtxoActivityReader {
  readPage(source: UtxoActivitySource, request: Readonly<{ page: number }>, signal: AbortSignal): Promise<UtxoActivityPage>;
  readDetail(source: UtxoActivitySource, request: Readonly<{ row: UtxoActivityRow; txid: string }>, signal: AbortSignal,
    cache: UtxoActivityDetailCache, guard: () => void): Promise<UtxoActivityDetail>;
  summaryBytes(row: UtxoActivityRow): number | null;
  forgetDetails(rows: readonly UtxoActivityRow[]): void;
}
export class UtxoActivityError extends Error {
  readonly code: 'INVALID' | 'UNAVAILABLE' | 'CHANGED' | 'CANCELLED';
  constructor(code: UtxoActivityError['code']) { super('Account activity is unavailable'); this.name = 'UtxoActivityError'; this.code = code; }
}
const fail = (code: UtxoActivityError['code'] = 'INVALID'): never => { throw new UtxoActivityError(code); };
const hash = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : fail();
function context(value: UtxoActivityContext): UtxoActivityContext {
  assertJsonWorkBudget(value, 2048, 3, 30);
  if (typeof value.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.accountId) || !Number.isSafeInteger(value.generation) || value.generation < 0) return fail();
  const networkId = getUtxoNetwork(value.networkId).id;
  return Object.freeze({ accountId: value.accountId, networkId, address: normalizeUtxoAddress(value.address, networkId), generation: value.generation });
}
function units(value: unknown): string | null {
  // Same bounded native amount domain used by the public balance surface.
  if (typeof value === 'string' && value.length > UTXO_ACTIVITY_LIMITS.nativeIntegerDigits) return null;
  const normalized = getSyscoinAccountChange({ addressValueIn: '0', addressValueOut: value as string });
  if (normalized === null) return null;
  try { assertBaseUnits(normalized); return normalized; } catch { return null; }
}
/** Native work admission only; shared code still decides validity and meaning. */
function assertNativeHistoryWork(value: unknown): void {
  const transactions = value && typeof value === 'object' ? (value as Record<string, unknown>).transactions : undefined;
  if (!Array.isArray(transactions)) return;
  if (transactions.length > UTXO_ACTIVITY_LIMITS.pageSize) return fail();
  const text = (amount: unknown) => {
    if (typeof amount === 'string' && amount.length > UTXO_ACTIVITY_LIMITS.nativeIntegerDigits) return fail();
  };
  for (const transaction of transactions) {
    if (!transaction || typeof transaction !== 'object') continue;
    text(transaction.addressValueIn); text(transaction.addressValueOut); text(transaction.fees);
    for (const entries of [transaction.vin, transaction.vout]) {
      if (Array.isArray(entries)) for (const entry of entries) text(entry?.value);
    }
  }
}
/** Shared token interpretation; this adapter exposes only bounded display metadata.
 * parseErc20Text supplies the existing wallet symbol rendering budget only. No
 * ERC20 address, precision or amount rule is applied to the Syscoin asset.
 */
function projectAssetAmount(tx: Record<string, any>): UtxoActivityAssetAmount | null {
  const amount = getSyscoinActivityOperationAmount(tx);
  if (amount === null) return null;
  let symbol: string | undefined;
  try { symbol = parseErc20Text(amount.symbol, 'symbol'); } catch { /* Neutral asset label for unavailable display text. */ }
  // Blockbook's SPT asset GUID is serialized from uint64, including NFT IDs.
  const assetGuid = typeof amount.assetGuid === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(amount.assetGuid) &&
    (amount.assetGuid.length < 20 || amount.assetGuid <= '18446744073709551615') ? amount.assetGuid : undefined;
  return Object.freeze({ amount: amount.amount, scope: amount.scope,
    ...(assetGuid === undefined ? {} : { assetGuid }),
    ...(amount.decimals === undefined ? {} : { decimals: amount.decimals }),
    ...(amount.direction === undefined ? {} : { direction: amount.direction }),
    ...(symbol === undefined ? {} : { symbol }) });
}
function projectTransaction(value: unknown): UtxoActivityRow {
  const tx = utxoObject(value), txid = hash(tx.txid);
  const confirmations = tx.confirmations === undefined ? 0 : readHistoryCount(tx.confirmations);
  if (confirmations === null) return fail();
  const observedHeight = getTransactionBlockInfo(tx);
  const height = observedHeight === null ? null : readHistoryCount(observedHeight);
  const blockHash = tx.blockHash === undefined || tx.blockHash === null || tx.blockHash === '' ? null : hash(tx.blockHash);
  const timestamp = tx.blockTime === undefined || tx.blockTime === null ? null : readHistoryCount(tx.blockTime);
  if (height !== null && (!Number.isSafeInteger(height) || height < 1) || timestamp !== null && timestamp > 8640000000000) return fail();
  const receivedUnits = units(tx.addressValueOut), spentUnits = units(tx.addressValueIn);
  const netUnits = receivedUnits === null || spentUnits === null ? null : getSyscoinAccountChange({ addressValueIn: spentUnits, addressValueOut: receivedUnits });
  const hasAssetData = isSyscoinTokenOperation(tx);
  // The shared amount helper owns interpretation. Bound its work without
  // interpreting unbounded numeric text or scanning addresses ourselves.
  const boundedValues = [tx.fees, tx.addressValueIn, tx.addressValueOut, ...[tx.vin, tx.vout].flatMap((entries) => Array.isArray(entries) ? entries.map((entry) => entry?.value) : [])]
    .every((amount) => typeof amount !== 'string' || amount.length <= UTXO_ACTIVITY_LIMITS.nativeIntegerDigits);
  let nativeTransfer = boundedValues ? getSyscoinNativeTransferAmount(tx) : null;
  if (nativeTransfer) { try { assertBaseUnits(nativeTransfer.amount); } catch { nativeTransfer = null; } }
  return Object.freeze({ txid, block: height === null ? null : Object.freeze({ height, hash: blockHash, timestamp }),
    observedConfirmations: confirmations, receivedUnits, spentUnits, netUnits, transactionFeeUnits: units(tx.fees),
    hasAssetData, assetAmount: hasAssetData ? projectAssetAmount(tx) : null, nativeTransfer: nativeTransfer === null ? null : Object.freeze(nativeTransfer) });
}

/** Actual SJS account routing with the existing bounded, genesis-verified transport. */
export function createUtxoActivityReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoActivityReader {
  const checked = utxoFetchOptions(options, UTXO_ACTIVITY_LIMITS.timeoutMs);
  const sjsAccount = syscoinUtils.fetchBackendAccount, sjsRaw = syscoinUtils.fetchBackendRawTx;
  const history = createBlockbookAccountHistory(async () => fail('INVALID'));
  const summaries = new WeakMap<UtxoActivityRow, { source: UtxoActivitySource; raw: UtxoDetailTransaction; charge: number; observation: number }>();
  let observationSequence = 0;
  return Object.freeze({ async readPage(input: UtxoActivitySource, request: Readonly<{ page: number }>, signal: AbortSignal) {
    const owner = context(input.context), page = request.page, identifier = input.identifier, isAccount = input.isAccount;
    if (!Number.isSafeInteger(page) || page < 1 || typeof isAccount !== 'boolean') return fail();
    if (isAccount) assertPublicWatchOnlyIdentifier(identifier);
    else if (normalizeUtxoAddress(identifier, owner.networkId) !== owner.address) return fail();
    let workFailure: UtxoActivityError | null = null;
    const check = () => { if (workFailure) throw workFailure; if (signal.aborted) fail('CANCELLED'); };
    check(); let session: UtxoReadSession | undefined;
    try {
      session = await openUtxoReadSession(owner.networkId, checked, signal, false, UTXO_ACTIVITY_LIMITS.bytes, UTXO_ACTIVITY_LIMITS.bytes);
      check(); const active = session, prefix = active.network.endpoint.replace(/\/$/, '');
      const fetchAccount = async (url: string, queriedIdentifier: string, query: string, _parseData: boolean) => {
        check();
        if (url !== prefix || queriedIdentifier !== identifier) return fail('CHANGED');
        const raw = await sjsAccount(prefix, identifier, query, isAccount, undefined, { signal,
          fetch: async (target: string, init: RequestInit) => {
            check();
            if (init.method !== 'GET' || init.signal !== signal || !target.startsWith(prefix + '/api/v2/')) return fail();
            const body = await active.read(target.slice(prefix.length), true); check();
            try {
              assertJsonWorkBudget(body, UTXO_ACTIVITY_LIMITS.bytes, 16, UTXO_ACTIVITY_LIMITS.nodes);
              assertNativeHistoryWork(body);
            } catch {
              workFailure = new UtxoActivityError('INVALID');
              active.close();
              throw workFailure;
            }
            return { ok: true, json: async () => body };
          },
        }); check(); return raw;
      };
      const raw = utxoObject(await history.fetchAccountHistory(prefix, identifier,
        history.getHistoryRequestOptions(prefix, identifier, page, UTXO_ACTIVITY_LIMITS.pageSize), page > 1, { fetch: fetchAccount, assertCurrent: check }));
      check();
      if (raw.address !== identifier || raw.page !== undefined && readHistoryCount(raw.page) !== page ||
          raw.itemsOnPage !== undefined && readHistoryCount(raw.itemsOnPage) !== UTXO_ACTIVITY_LIMITS.pageSize ||
          !Array.isArray(raw.transactions) || raw.transactions.length > UTXO_ACTIVITY_LIMITS.pageSize) return fail();
      const totalPages = raw.totalPages === undefined || raw.totalPages === -1 ? null : readHistoryCount(raw.totalPages);
      if (raw.totalPages !== undefined && raw.totalPages !== -1 && totalPages === null) return fail();
      const rows = Object.freeze(raw.transactions.map(projectTransaction));
      const result = Object.freeze({ context: owner, page, rows,
        hasMore: totalPages === null ? raw.transactions.length === UTXO_ACTIVITY_LIMITS.pageSize : page < totalPages,
        emptyAccount: rows.length === 0 && readHistoryCount(raw.txs) === 0 && readHistoryCount(raw.unconfirmedTxs) === 0 });
      const captured = Object.freeze({ context: owner, identifier, isAccount });
    const observation = ++observationSequence;
      for (let index = 0; index < rows.length; index++) {
        const summary = raw.transactions[index] as UtxoDetailTransaction;
        try {
          const charge = measureJsonWorkBudget(summary, UTXO_DETAIL_CACHE_BYTES, 16, UTXO_ACTIVITY_LIMITS.nodes);
          summaries.set(rows[index]!, { source: captured, raw: summary, charge, observation });
        } catch { /* Optional detail metadata; the compact row remains valid. */ }
      }
      return result;
    } catch (cause) { throw cause instanceof UtxoActivityError ? cause : new UtxoActivityError(signal.aborted ? 'CANCELLED' : 'UNAVAILABLE'); }
    finally { session?.close(); }
  }, async readDetail(input: UtxoActivitySource, request: Readonly<{ row: UtxoActivityRow; txid: string }>, signal: AbortSignal,
    cache: UtxoActivityDetailCache, guard: () => void) {
    const owner = context(input.context), identifier = input.identifier, isAccount = input.isAccount;
    const txid = hash(request.txid), accepted = summaries.get(request.row);
    const summary = accepted?.raw;
    if (!accepted || !summary || hash(summary.txid) !== txid || request.row.txid !== txid || !same(accepted.source.context, owner) || accepted.source.identifier !== identifier || accepted.source.isAccount !== isAccount) return fail('CHANGED');
    const check = () => { guard(); if (signal.aborted) fail('CANCELLED'); };
    check();
    const read = async (physicalSignal: AbortSignal) => {
      let session: UtxoReadSession | undefined;
      try {
        session = await openUtxoReadSession(owner.networkId, checked, physicalSignal, false, UTXO_ACTIVITY_LIMITS.bytes, UTXO_ACTIVITY_LIMITS.bytes);
        const active = session, prefix = active.network.endpoint.replace(/\/$/, '');
        const dispatch = ++observationSequence;
        const result = await sjsRaw(prefix, txid, { signal: physicalSignal, fetch: async (target: string, init: RequestInit) => {
          if (init.method !== 'GET' || init.signal !== physicalSignal || target !== prefix + '/api/v2/tx/' + txid) return fail();
          const value = await active.read('/api/v2/tx/' + txid);
          assertJsonWorkBudget(value, UTXO_ACTIVITY_LIMITS.bytes, 16, UTXO_ACTIVITY_LIMITS.nodes);
          assertNativeHistoryWork({ transactions: [value] });
          return { ok: true, json: async () => value };
        } });
        if (physicalSignal.aborted) return fail('CANCELLED');
        const value = utxoObject(result);
        if (hash(value.txid) !== txid) return fail('INVALID');
        return bindUtxoDetailObservation(value, { dispatch });
      } finally { session?.close(); }
    };
    let stop: (() => void) | undefined;
    let abort: (() => void) | undefined;
    try {
      const full = await new Promise<UtxoDetailTransaction>((resolve, reject) => {
        abort = () => { stop?.(); reject(new UtxoActivityError('CANCELLED')); };
        signal.addEventListener('abort', abort, { once: true });
        stop = cache.watchUtxoTransactionDetails(txid, txid, read, () => { try { check(); return true; } catch { return false; } }, resolve, reject);
        if (signal.aborted) abort();
      });
      check();
      const merged = mergeAccountSummaryWithFullTransaction(summary, full, accepted.observation);
      const row = projectTransaction(merged), from = getSendingAddresses(merged), to = getReceivingAddresses(merged);
      assertJsonWorkBudget({ from, to }, 32768, 4, 2048);
      if (isAccount && [...from, ...to].some(value => value === identifier)) return fail('INVALID');
      check();
      return Object.freeze({ txid, row, from: Object.freeze(from), to: Object.freeze(to) });
    } finally { if (abort) signal.removeEventListener('abort', abort); stop?.(); }
  }, summaryBytes(row: UtxoActivityRow) { return summaries.get(row)?.charge ?? null; },
  forgetDetails(rows: readonly UtxoActivityRow[]) { for (const row of rows) summaries.delete(row); } });
}

type PublicAuthority = { getSnapshot(): PublicSnapshot; subscribe(listener: (snapshot: PublicSnapshot) => void): () => void;
  readUtxoActivityPage(request: Readonly<{ page: number }>, signal: AbortSignal): Promise<UtxoActivityPage>;
  readUtxoActivityDetail(request: Readonly<{ txid: string }>, signal: AbortSignal): Promise<UtxoActivityDetail>;
  retainUtxoActivityRows(rows: readonly UtxoActivityRow[]): void; releaseUtxoActivity(): void };
export type UtxoActivityState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'stale'; context: UtxoActivityContext | null;
  rows: readonly UtxoActivityRow[]; detail: Readonly<{ txid: string; status: 'loading' | 'ready' | 'unavailable'; row: UtxoActivityRow; from: readonly string[]; to: readonly string[] }> | null; firstPage: number; page: number; hasMore: boolean; hasNewer: boolean; windowed: boolean;
}>;
const same = (a: UtxoActivityContext | null, b: UtxoActivityContext | null) => a !== null && b !== null &&
  a.accountId === b.accountId && a.networkId === b.networkId && a.address === b.address && a.generation === b.generation;
const wrap = (row: UtxoActivityRow) => ({ txid: row.txid, confirmations: row.observedConfirmations,
  blockHeight: row.block?.height, blockHash: row.block?.hash, blockTime: row.block?.timestamp, row });
/** Foreground screen paging; authority owns the canonical source and transport. */
export class UtxoWatchActivity {
  private state: UtxoActivityState;
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private epoch = 0;
  private pending: AbortController | null = null;
  private detailRequest: AbortController | null = null;
  private active = false;
  private focused = true;
  private pages = new Map<number, { rows: readonly UtxoActivityRow[]; hasMore: boolean }>();
  private readonly authority: PublicAuthority;
  private readonly foreground: () => boolean;
  constructor(authority: PublicAuthority, foreground: () => boolean) { this.authority = authority; this.foreground = foreground; this.state = this.empty(); }
  private capture(): UtxoActivityContext | null {
    const value = this.authority.getSnapshot(), account = value.accounts.find((a) => a.id === value.selectedAccountId);
    if (value.status !== 'ready' || !account || value.selectedNetworkId !== 'bitcoin' && value.selectedNetworkId !== 'syscoin') return null;
    try { return context({ accountId: account.id, networkId: value.selectedNetworkId, address: account.addresses[value.selectedNetworkId]!, generation: value.generation }); } catch { return null; }
  }
  private empty(): UtxoActivityState { return Object.freeze({ status: 'idle', context: this.capture(), rows: Object.freeze([]), detail: null, firstPage: 0, page: 0, hasMore: false, hasNewer: false, windowed: false }); }
  private publish(value: UtxoActivityState) { this.state = Object.freeze(value); for (const listener of [...this.listeners]) { if (this.state !== value) break; if (this.listeners.has(listener)) { try { listener(); } catch { /* Observers cannot block revocation. */ } } } }
  getSnapshot = (): UtxoActivityState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate(): void {
    if (this.active) return; this.active = true;
    this.stop = this.authority.subscribe(() => { if (!same(this.state.context, this.capture())) { this.revoke(); void this.load(); } });
    this.revoke(); void this.load();
  }
  revoke(): void { this.detailRequest?.abort(); this.detailRequest = null; this.authority.releaseUtxoActivity(); this.epoch++; this.pending?.abort(); this.pending = null; this.pages.clear(); this.publish(this.empty()); }
  dispose(): void { this.active = false; this.stop?.(); this.stop = null; this.revoke(); }
  setFocused(value: boolean): void { this.focused = value; if (!value) this.revoke(); else void this.load(); }
  isCurrent(expected = this.state.context): boolean { return this.active && this.focused && this.foreground() && same(expected, this.capture()); }
  clearDetail(): void {
    if (!this.state.detail && !this.detailRequest) return;
    this.detailRequest?.abort(); this.detailRequest = null;
    this.publish({ ...this.state, detail: null });
  }
  selectDetail = async (value: string): Promise<void> => {
    const txid = hash(value), owner = this.state.context, row = this.state.rows.find(item => item.txid === txid);
    if (!row || !owner || !this.isCurrent(owner)) return;
    this.detailRequest?.abort(); const request = new AbortController(); this.detailRequest = request;
    const current = () => this.detailRequest === request && !request.signal.aborted && this.isCurrent(owner) && this.state.detail?.txid === txid;
    this.publish({ ...this.state, detail: Object.freeze({ txid, status: 'loading', row, from: Object.freeze([]), to: Object.freeze([]) }) });
    try {
      const result = await this.authority.readUtxoActivityDetail({ txid }, request.signal);
      if (!current()) return;
      this.publish({ ...this.state, detail: Object.freeze({ ...result, status: 'ready' }) });
    } catch {
      if (current()) this.publish({ ...this.state, detail: Object.freeze({ txid, status: 'unavailable', row, from: Object.freeze([]), to: Object.freeze([]) }) });
    } finally { if (this.detailRequest === request) this.detailRequest = null; request.abort(); }
  };
  retryDetail = (): Promise<void> => this.state.detail ? this.selectDetail(this.state.detail.txid) : Promise.resolve();
  load = (): Promise<void> => this.run('refresh');
  refresh = (): Promise<void> => this.run('refresh');
  loadMore = (): Promise<void> => this.state.status !== 'ready' || !this.state.hasMore ? Promise.resolve() : this.run('older');
  loadNewer = (): Promise<void> => this.state.status !== 'ready' || !this.state.hasNewer ? Promise.resolve() : this.run('newer');
  private async run(mode: 'refresh' | 'older' | 'newer'): Promise<void> {
    if (this.pending || !this.isCurrent()) return;
    const before = this.state, owner = before.context!, epoch = ++this.epoch, pending = new AbortController();
    const page = mode === 'older' ? before.page + 1 : mode === 'newer' ? before.firstPage - 1 : 1;
    this.clearDetail();
    this.pending = pending; this.publish({ ...this.state, status: 'loading' });
    const current = () => this.pending === pending && epoch === this.epoch && !pending.signal.aborted && this.isCurrent(owner);
    try {
      if (!current()) return;
      const value = await this.authority.readUtxoActivityPage({ page }, pending.signal);
      if (!current()) return;
      if (!same(value.context, owner) || value.page !== page) return fail('CHANGED');
      if (mode === 'refresh' && before.firstPage > 1 || value.emptyAccount && !before.rows.some((row) => row.block === null)) this.pages.clear();
      for (const [number, saved] of this.pages) {
        const retained = mergeFreshBlockbookHistory(value.rows, saved.rows).slice(value.rows.length);
        this.pages.set(number, { ...saved, rows: retained });
      }
      const prior = this.pages.get(page)?.rows ?? [];
      this.pages.set(page, { rows: mergeFreshBlockbookHistory(value.rows, prior), hasMore: value.hasMore });
      while (this.pages.size > UTXO_ACTIVITY_LIMITS.windowPages) {
        const indices = [...this.pages.keys()]; this.pages.delete(mode === 'newer' ? Math.max(...indices) : Math.min(...indices));
      }
      const indices = [...this.pages.keys()].sort((a, b) => a - b), firstPage = indices[0]!, lastPage = indices.at(-1)!;
      const flattened = indices.flatMap((number) => this.pages.get(number)!.rows);
      const rows = Object.freeze(selectEvmHistoryRepresentatives(flattened.map(wrap), UTXO_ACTIVITY_LIMITS.displayRows).map((entry) => entry.row));
      const retainedRows = new Set(rows);
      for (const [number, saved] of this.pages) this.pages.set(number, { ...saved, rows: saved.rows.filter((row) => retainedRows.has(row)) });
      this.authority.retainUtxoActivityRows(rows);
      this.publish({ status: 'ready', context: owner, rows, detail: null, firstPage, page: lastPage,
        hasMore: this.pages.get(lastPage)!.hasMore, hasNewer: firstPage > 1, windowed: firstPage > 1 || flattened.length > UTXO_ACTIVITY_LIMITS.displayRows });
    } catch { if (current()) this.publish({ ...before, detail: null, status: before.rows.length ? 'stale' : 'unavailable', hasMore: false }); }
    finally { pending.abort(); if (this.pending === pending) this.pending = null; }
  }
}
