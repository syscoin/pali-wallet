import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { assertBaseUnits } from './amounts.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { openUtxoReadSession, utxoCount, utxoFetchOptions, utxoObject, type UtxoFetch } from './utxoReadSession.ts';
import type { WatchOnlyAuthority } from './watchOnlyAuthority.ts';

export const UTXO_ACTIVITY_LIMITS = Object.freeze({ pageSize: 20, pages: 5, workers: 2, inputs: 128, outputs: 128, bytes: 1024 * 1024, timeoutMs: 30000 });
export type UtxoActivityContext = Readonly<{ accountId: string; networkId: UtxoNetworkId; address: string; generation: number }>;
export type UtxoActivityAnchor = Readonly<{ height: number; hash: string }>;
export type UtxoActivityRow = Readonly<{
  txid: string; block: Readonly<{ height: number; hash: string; timestamp: number | null }>;
  observedConfirmations: number; receivedUnits: string; spentUnits: string; netUnits: string;
  transactionFeeUnits: string | null; hasUnsupportedAssetData: boolean;
}>;
export type UtxoActivityPage = Readonly<{
  context: UtxoActivityContext; anchor: UtxoActivityAnchor; page: number;
  rows: readonly UtxoActivityRow[]; hasMore: boolean; limitReached: boolean;
}>;
export interface UtxoActivityReader {
  readPage(context: UtxoActivityContext, request: Readonly<{ page: number; anchor?: UtxoActivityAnchor }>, signal: AbortSignal): Promise<UtxoActivityPage>;
}
export class UtxoActivityError extends Error {
  readonly code: 'INVALID' | 'UNAVAILABLE' | 'CHANGED' | 'CANCELLED';
  constructor(code: UtxoActivityError['code']) { super('Confirmed activity is unavailable'); this.name = 'UtxoActivityError'; this.code = code; }
}
const fail = (code: UtxoActivityError['code'] = 'INVALID'): never => { throw new UtxoActivityError(code); };
const hash = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : fail();
function object(value: unknown): Record<string, unknown> {
  assertJsonWorkBudget(value, 32768, 12, 4000);
  return utxoObject(value);
}
function units(value: unknown): bigint {
  if (typeof value !== 'string') return fail();
  return assertBaseUnits(value);
}
function context(value: UtxoActivityContext): UtxoActivityContext {
  object(value);
  if (typeof value.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.accountId) || !Number.isSafeInteger(value.generation) || value.generation < 0) return fail();
  const networkId = getUtxoNetwork(value.networkId).id;
  return Object.freeze({ accountId: value.accountId, networkId, address: normalizeUtxoAddress(value.address, networkId), generation: value.generation });
}
function anchor(value: UtxoActivityAnchor): UtxoActivityAnchor {
  object(value);
  if (!Number.isInteger(value.height) || value.height < 1 || value.height > 0xffffffff) return fail();
  return Object.freeze({ height: value.height, hash: hash(value.hash) });
}
function owns(raw: Record<string, unknown>, owner: UtxoActivityContext, input: boolean): boolean {
  if (typeof raw.isAddress !== 'boolean') return fail();
  const addresses = raw.addresses === undefined && input ? [] : raw.addresses;
  if (!Array.isArray(addresses) || addresses.length > 8) return fail();
  let matched = false;
  for (const address of addresses) {
    if (typeof address !== 'string' || address.length > 200 || !/^[\x20-\x7e]*$/.test(address)) return fail();
    if (address.toLowerCase() === owner.address) {
      if (!raw.isAddress || addresses.length !== 1 || normalizeUtxoAddress(address, owner.networkId) !== owner.address) return fail();
      matched = true;
    }
  }
  return matched;
}
/** Project native values only; provider direction, aliases, scripts and asset amounts never escape. */
export function parseUtxoActivityTransaction(value: unknown, txid: string, owner: UtxoActivityContext, at: UtxoActivityAnchor): UtxoActivityRow {
  owner = context(owner); at = anchor(at);
  const raw = object(value);
  if (hash(raw.txid) !== hash(txid) || !Array.isArray(raw.vin) || !raw.vin.length || raw.vin.length > UTXO_ACTIVITY_LIMITS.inputs ||
      !Array.isArray(raw.vout) || !raw.vout.length || raw.vout.length > UTXO_ACTIVITY_LIMITS.outputs) return fail();
  const height = utxoCount(raw.blockHeight), confirmations = utxoCount(raw.confirmations), blockHash = hash(raw.blockHash);
  if (height > at.height || !confirmations) return fail('CHANGED');
  const time = utxoCount(raw.blockTime);
  if (time > 8640000000000) return fail();
  let incoming = 0n, outgoing = 0n, inputTotal = 0n, outputTotal = 0n, related = false;
  let assets = Object.hasOwn(raw, 'tokenType') || Object.hasOwn(raw, 'accountAssetTransfers') ||
    (raw.tokenTransfers !== undefined && (!Array.isArray(raw.tokenTransfers) || raw.tokenTransfers.length > 0));
  let coinbase = false;
  raw.vin.forEach((value, index) => {
    const item = object(value);
    if (item.n !== index) return fail();
    const own = owns(item, owner, true);
    if (Object.hasOwn(item, 'coinbase')) {
      if (raw.vin instanceof Array && raw.vin.length !== 1 || typeof item.coinbase !== 'string' || !/^(?:[0-9a-fA-F]{2}){1,100}$/.test(item.coinbase) ||
          item.txid !== undefined || item.isAddress !== false || own || item.value !== undefined && item.value !== '0') return fail();
      coinbase = true;
    } else {
      hash(item.txid);
      const amount = units(item.value); inputTotal += amount;
      if (own) { outgoing += amount; related = true; }
    }
    assets ||= Object.hasOwn(item, 'assetInfo');
  });
  raw.vout.forEach((value, index) => {
    const item = object(value);
    if (item.n !== index) return fail();
    const own = owns(item, owner, false), amount = units(item.value); outputTotal += amount;
    if (own) { incoming += amount; related = true; }
    assets ||= Object.hasOwn(item, 'assetInfo');
  });
  const fee = units(raw.fees);
  if (!related || units(raw.valueIn) !== inputTotal || units(raw.value) !== outputTotal ||
      (coinbase ? inputTotal !== 0n || fee !== 0n : inputTotal < outputTotal || fee !== inputTotal - outputTotal)) return fail();
  for (const amount of [incoming, outgoing, inputTotal, outputTotal]) assertBaseUnits(amount.toString());
  return Object.freeze({ txid, block: Object.freeze({ height, hash: blockHash, timestamp: time || null }), observedConfirmations: at.height - height + 1,
    receivedUnits: incoming.toString(), spentUnits: outgoing.toString(), netUnits: (incoming - outgoing).toString(),
    transactionFeeUnits: coinbase ? null : fee.toString(), hasUnsupportedAssetData: assets });
}

/** Fixed address-only REST V2. Each explicit page is one bounded, anchored observation. */
export function createUtxoActivityReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoActivityReader {
  const checked = utxoFetchOptions(options, UTXO_ACTIVITY_LIMITS.timeoutMs);
  return Object.freeze({ async readPage(input: UtxoActivityContext, request: Readonly<{ page: number; anchor?: UtxoActivityAnchor }>, signal: AbortSignal) {
    const owner = context(input);
    object(request);
    const page = request.page;
    if (!Number.isInteger(page) || page < 1 || page > UTXO_ACTIVITY_LIMITS.pages ||
        (page === 1 ? request.anchor !== undefined : request.anchor === undefined)) return fail();
    const previous = request.anchor === undefined ? null : anchor(request.anchor);
    const check = () => { if (signal.aborted) fail('CANCELLED'); };
    check();
    const session = await openUtxoReadSession(owner.networkId, checked, signal, true, UTXO_ACTIVITY_LIMITS.bytes);
    try {
      check();
      const at = previous ?? anchor({ height: session.observedHeight, hash: session.anchorHash! });
      if (at.height > session.observedHeight) return fail('CHANGED');
      const checkOriginal = async () => { if (hash(object(await session.read(`/api/v2/block-index/${at.height}`)).blockHash) !== at.hash) fail('CHANGED'); check(); };
      if (previous) await checkOriginal();
      const raw = object(await session.read(`/api/v2/address/${encodeURIComponent(owner.address)}?details=txids&pageSize=20&page=${page}&to=${at.height}`));
      check();
      if (raw.address !== owner.address || raw.page !== page || raw.itemsOnPage !== UTXO_ACTIVITY_LIMITS.pageSize ||
          !Number.isSafeInteger(raw.totalPages) || raw.totalPages !== -1 && (raw.totalPages as number) < page) return fail();
      utxoCount(raw.txs); utxoCount(raw.unconfirmedTxs);
      const ids = raw.txids === undefined ? [] : raw.txids;
      if (!Array.isArray(ids) || ids.length > UTXO_ACTIVITY_LIMITS.pageSize) return fail();
      const txids = ids.map(hash);
      if (new Set(txids).size !== txids.length) return fail();
      const rows: UtxoActivityRow[] = new Array(txids.length), blocks = new Map<number, Promise<string>>();
      let index = 0;
      await Promise.all(Array.from({ length: UTXO_ACTIVITY_LIMITS.workers }, async () => {
        while (index < txids.length) {
          const position = index++, id = txids[position]!;
          check();
          const row = parseUtxoActivityTransaction(await session.read(`/api/v2/tx/${id}`), id, owner, at);
          check();
          let block = blocks.get(row.block.height);
          if (!block) { block = session.read(`/api/v2/block-index/${row.block.height}`).then((raw) => hash(object(raw).blockHash)); blocks.set(row.block.height, block); }
          if (await block !== row.block.hash) return fail('CHANGED');
          check(); rows[position] = row;
        }
      }));
      await session.verifyAnchor(); if (previous) await checkOriginal(); check();
      const more = txids.length === UTXO_ACTIVITY_LIMITS.pageSize && (raw.totalPages === -1 || page < (raw.totalPages as number));
      return Object.freeze({ context: owner, anchor: at, page: page, rows: Object.freeze(rows),
        hasMore: more && page < UTXO_ACTIVITY_LIMITS.pages, limitReached: more && page === UTXO_ACTIVITY_LIMITS.pages });
    } finally { session.close(); }
  } });
}

type PublicAuthority = Pick<WatchOnlyAuthority, 'getSnapshot' | 'subscribe'>;
export type UtxoActivityState = Readonly<{
  status: 'consent' | 'loading' | 'ready' | 'unavailable' | 'stale';
  context: UtxoActivityContext | null; anchor: UtxoActivityAnchor | null;
  rows: readonly UtxoActivityRow[]; page: number; hasMore: boolean; limitReached: boolean;
}>;
const same = (a: UtxoActivityContext | null, b: UtxoActivityContext | null) => a !== null && b !== null &&
  a.accountId === b.accountId && a.networkId === b.networkId && a.address === b.address && a.generation === b.generation;
/** An active screen owns this controller. It never starts I/O on mount or authority notification. */
export class UtxoWatchActivity {
  private state: UtxoActivityState;
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  private epoch = 0;
  private pending: AbortController | null = null;
  private active = false;
  private focused = true;
  private readonly authority: PublicAuthority;
  private readonly reader: UtxoActivityReader;
  private readonly foreground: () => boolean;
  constructor(authority: PublicAuthority, reader: UtxoActivityReader, foreground: () => boolean) {
    this.authority = authority; this.reader = reader; this.foreground = foreground; this.state = this.empty();
  }
  private capture(): UtxoActivityContext | null {
    const value = this.authority.getSnapshot(), account = value.accounts.find((a) => a.id === value.selectedAccountId);
    if (value.status !== 'ready' || !account || value.selectedNetworkId !== 'bitcoin' && value.selectedNetworkId !== 'syscoin') return null;
    try { return context({ accountId: account.id, networkId: value.selectedNetworkId, address: account.addresses[value.selectedNetworkId]!, generation: value.generation }); } catch { return null; }
  }
  private empty(): UtxoActivityState { return Object.freeze({ status: 'consent', context: this.capture(), anchor: null, rows: Object.freeze([]), page: 0, hasMore: false, limitReached: false }); }
  private publish(value: UtxoActivityState) {
    this.state = Object.freeze(value);
    for (const listener of [...this.listeners]) { if (this.state !== value) break; if (this.listeners.has(listener)) { try { listener(); } catch { /* Observers cannot block revocation. */ } } }
  }
  getSnapshot = (): UtxoActivityState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  activate(): void {
    if (this.active) return;
    this.active = true;
    this.stop = this.authority.subscribe(() => { if (!same(this.state.context, this.capture())) this.revoke(); });
    this.revoke();
  }
  revoke(): void { this.epoch++; this.pending?.abort(); this.pending = null; this.publish(this.empty()); }
  dispose(): void { this.active = false; this.stop?.(); this.stop = null; this.revoke(); }
  setFocused(value: boolean): void { this.focused = value; if (!value) this.revoke(); }
  isCurrent(expected = this.state.context): boolean { return this.active && this.focused && this.foreground() && same(expected, this.capture()); }
  load = (): Promise<void> => this.run(false);
  refresh = (): Promise<void> => this.state.status === 'consent' ? Promise.resolve() : this.run(false);
  loadMore = (): Promise<void> => this.state.status !== 'ready' || !this.state.hasMore ? Promise.resolve() : this.run(true);
  private async run(more: boolean): Promise<void> {
    if (this.pending || !this.isCurrent()) return;
    const before = this.state, owner = before.context!, epoch = ++this.epoch, pending = new AbortController();
    const page = more ? before.page + 1 : 1;
    this.pending = pending;
    this.publish({ ...before, status: 'loading' });
    const current = () => this.pending === pending && epoch === this.epoch && !pending.signal.aborted && this.isCurrent(owner);
    try {
      if (!current()) return;
      const value = await this.reader.readPage(owner, { page, ...(more ? { anchor: before.anchor! } : {}) }, pending.signal);
      if (!current()) return;
      if (!same(value.context, owner) || value.page !== page || more && (value.anchor.hash !== before.anchor?.hash || value.anchor.height !== before.anchor.height) ||
          more && value.rows.some((row) => before.rows.some((previous) => previous.txid === row.txid))) return fail('CHANGED');
      this.publish({ status: 'ready', context: owner, anchor: value.anchor, rows: Object.freeze(more ? [...before.rows, ...value.rows] : [...value.rows]),
        page, hasMore: value.hasMore, limitReached: value.limitReached });
    } catch {
      if (current()) this.publish({ ...before, status: before.rows.length ? 'stale' : 'unavailable', hasMore: false });
    } finally {
      pending.abort(); if (this.pending === pending) this.pending = null;
    }
  }
}
