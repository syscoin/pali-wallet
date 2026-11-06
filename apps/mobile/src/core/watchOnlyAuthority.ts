import { utxoObservation } from './utxoBalance.ts';
import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { createActivityReadScope, type EvmActivityReadScope } from '../activity/types.ts';
import type { EvmActivityReaders } from '../activity/nativeActivity.ts';
import type { ActivityFeed } from '../activity/explorerReader.ts';
import { getNativeNetwork } from '../custody/networkContext.ts';
import { createUtxoTransactionDetailsCache, UTXO_DETAIL_CACHE_BYTES } from '../../../../source/shared/utxoTransactionDetailCache.ts';
import type { UtxoActivityReader, UtxoActivityPage, UtxoActivityDetail, UtxoActivityRow } from './utxoActivity.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { normalizePublicAddress } from './addresses.ts';
import { loadedBalance } from './amounts.ts';
import { getNetwork, NETWORKS } from './networks.ts';
import { getUtxoNetwork, isCustomUtxoNetworkId, UTXO_NETWORKS, utxoRegistrationData, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import type { UtxoBalance } from './utxoBalanceReader.ts';
import type { WatchRecordRepository, WatchRecordSnapshot } from './publicAccountStorage.ts';
import { createWatchAccountCodec, type StoredWatchAccount } from './watchAccountCodec.ts';
import type {
  NetworkId,
  PublicAccount,
  PublicBalance,
  PublicSnapshot,
  SubmissionStatus,
  TransferIntent,
  TransferReview,
  WalletAuthority,
  WalletNetwork,
} from './types.ts';

type RecordOpenOptions = Readonly<{
  repository: Pick<WatchRecordRepository, 'load' | 'assertNetworkCurrent'>; reader: BalanceReader;
  signal: AbortSignal; now?: () => number; historyReader?: UtxoActivityReader; evmActivityReaders?: EvmActivityReaders;
  idle?: { begin(): void; check(): boolean; stop(): void };
}>;
type AccountSource = Extract<StoredWatchAccount, { kind: 'utxo-public' }>;
type RecordSession = {
  repository: Pick<WatchRecordRepository, 'load'>; identity: string;
  sources: ReadonlyMap<string, AccountSource>;
  assertNetworkCurrent: () => void;
};
function ownFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length)
    throw new Error('Invalid public account read binding');
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new Error('Invalid public account read binding');
    copy[key] = d.value;
  }
  return copy;
}
function recordView(snapshot: WatchRecordSnapshot) {
  const data = ownFields(snapshot, ['version', 'records', 'accounts', 'utxoNetworks']);
  if (data.version !== 1) throw new Error('Invalid public account record version');
  if (!Array.isArray(data.utxoNetworks)) throw new Error('Invalid public UTXO registrations');
  const decoded = createWatchAccountCodec(data.utxoNetworks).validate(data.records), { records, utxoNetworks } = decoded;
  const accounts = validatePublicAccounts(data.accounts, utxoNetworks);
  if (JSON.stringify(decoded.accounts) !== JSON.stringify(accounts)) throw new Error('Public account projection changed');
  return { records, accounts, utxoNetworks, identity: JSON.stringify({ version: data.version, records, accounts, utxoNetworks: utxoNetworks.map(utxoRegistrationData) }) };
}
function admissionCancelled(): Error { return new Error('Public account opening was cancelled'); }
function ownFunction(value: unknown, name: string): (...args: never[]) => unknown {
  const d = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, name) : undefined;
  if (!d?.enumerable || !Object.hasOwn(d, 'value') || typeof d.value !== 'function') throw new Error('Missing public account read port');
  return d.value;
}

export interface BalanceReader {
  /** Implementations must verify the connected chain before returning an observation. */
  readBalance(
    networkId: NetworkId,
    address: string,
    signal: AbortSignal
  ): Promise<{ chainId: number; units: string }>;
  /** Separate from the EVM observation contract; amounts are never combined. */
  readUtxoBalance?(scope: UtxoNetworkId | UtxoNetwork, address: string, signal: AbortSignal, assertCurrent?: () => void): Promise<UtxoBalance>;
  readUtxoAccount?(scope: UtxoNetworkId | UtxoNetwork, identifier: string, signal: AbortSignal, assertCurrent?: () => void): Promise<UtxoBalance>;
}

/** Untrusted persisted public data must not import private keyring records. */
export function validatePublicAccounts(
  input: unknown,
  registrations = UTXO_NETWORKS
): readonly PublicAccount[] {
  assertJsonWorkBudget(input, 32_768, 5, 500);
  if (!Array.isArray(input) || input.length > 20)
    throw new Error('Invalid public account list');
  const ids = new Set<string>();
  return Object.freeze(
    input.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid public account');
      if (
        Reflect.ownKeys(raw).length !== 3 || Object.keys(raw).length !== 3 || Object.keys(raw).some(
          (key) => !['id', 'name', 'addresses'].includes(key)
        )
      )
        throw new Error('Unexpected account data');
      const { id, name, addresses } = raw;
      if (
        typeof id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        ids.has(id)
      )
        throw new Error('Invalid account identity');
      if (
        typeof name !== 'string' ||
        name.trim() !== name ||
        name.length < 1 ||
        name.length > 40 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(name)
      )
        throw new Error('Invalid account name');
      if (
        !addresses ||
        typeof addresses !== 'object' ||
        Array.isArray(addresses)
      )
        throw new Error('Invalid public addresses');
      const networkIds = Object.keys(addresses);
      if (networkIds.length !== Reflect.ownKeys(addresses).length) throw new Error('Invalid public addresses');
      const utxo = networkIds.filter((id) => getNetwork(id as NetworkId, registrations).kind === 'utxo');
      if (utxo.length && (utxo.length !== 1 || networkIds.length !== 1))
        throw new Error('A UTXO watch account has exactly one network and address');
      const normalized: Partial<Record<NetworkId, string>> = {};
      for (const [networkId, address] of Object.entries(addresses)) {
        if (typeof address !== 'string')
          throw new Error('Invalid public address');
        normalized[networkId as NetworkId] = normalizePublicAddress(
          address,
          networkId as NetworkId, registrations
        );
      }
      if (Object.keys(normalized).length === 0)
        throw new Error('At least one supported public address is required');
      ids.add(id);
      return Object.freeze({ id, name, addresses: Object.freeze(normalized) });
    })
  );
}

/** A public EVM address is valid across the registered EVM chains. Keep Ethereum as the initial selection. */
export function createEvmWatchAccount(id: string, name: string, address: string): PublicAccount {
  const normalized = normalizePublicAddress(address, 'ethereum');
  const addresses: Partial<Record<NetworkId, string>> = { ethereum: normalized };
  for (const network of NETWORKS) {
    if (network.canWatch && network.kind === 'evm') addresses[network.id] = normalized;
  }
  return validatePublicAccounts([{ id, name, addresses }])[0]!;
}

export type WatchAccountNetwork = 'evm' | UtxoNetworkId;
/** Preserve EVM callers; a UTXO address is never copied to another network. */
export function createWatchAccount(id: string, name: string, address: string, network: WatchAccountNetwork = 'evm', registrations = UTXO_NETWORKS): PublicAccount {
  if (network === 'evm') return createEvmWatchAccount(id, name, address);
  const fixed = getUtxoNetwork(network, registrations);
  return validatePublicAccounts([{ id, name, addresses: { [fixed.id]: normalizePublicAddress(address, fixed.id, registrations) } }], registrations)[0]!;
}

/** Existing records retain their explicit address mappings; missing networks are never inferred. */
export function getWatchNetworks(account: PublicAccount | undefined, registrations = UTXO_NETWORKS): readonly WalletNetwork[] {
  const networks = [...registrations.map(({ id }) => getNetwork(id, registrations)), ...NETWORKS.filter(({ kind }) => kind === 'evm')];
  return Object.freeze(networks.filter((network) => network.canWatch && !!account?.addresses[network.id]));
}

export class WatchOnlyAuthority implements WalletAuthority {
  private readonly accounts: readonly PublicAccount[];
  private readonly utxoNetworks: readonly UtxoNetwork[];
  private readonly reader: BalanceReader;
  private readonly historyReader?: UtxoActivityReader;
  private readonly evmActivityReaders?: EvmActivityReaders;
  private readonly now: () => number;
  private listeners = new Set<(snapshot: PublicSnapshot) => void>();
  private generation = 0;
  private accountId: string | null;
  private networkId: NetworkId;
  private locked = true;
  private balance: PublicBalance = Object.freeze({ status: 'unknown' });
  private pending: AbortController | null = null;
  private historyRequests = new Set<AbortController>();
  private utxoRequests = new Set<AbortController>();
  private utxoRows = new Map<UtxoActivityRow, number>();
  private utxoDetailRequests = new Map<UtxoActivityRow, Set<AbortController>>();
  private utxoSummaryBytes = 0;
  private utxoDetails = createUtxoTransactionDetailsCache();
  private cachedSnapshot: PublicSnapshot | null = null;
  private recordSession: RecordSession | null = null;

  /** Open the canonical saved records; public snapshots expose addresses only. */
  static async openRecords(options: RecordOpenOptions): Promise<WatchOnlyAuthority> {
    const load = ownFunction(options.repository, 'load') as WatchRecordRepository['load'];
    const verify = ownFunction(options.repository, 'assertNetworkCurrent') as WatchRecordRepository['assertNetworkCurrent'];
    const signal = options.signal;
    let rejectAdmission!: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectAdmission = reject; });
    const abort = () => rejectAdmission(admissionCancelled());
    signal.addEventListener('abort', abort, { once: true });
    const check = () => { if (signal.aborted) throw admissionCancelled(); };
    try {
      check();
      const snapshot = await Promise.race([Promise.resolve().then(() => { check(); return load(); }), stopped]);
      check(); const view = recordView(snapshot), sources = new Map<string, AccountSource>();
      for (const record of view.records) {
        if (record.kind === 'utxo-public') sources.set(record.id, record);
      }
      check();
      const assertNetworkCurrent = () => {
        const result: unknown = verify(snapshot);
        if (result !== undefined) {
          void Promise.resolve(result).catch(() => undefined);
          throw new Error('Invalid UTXO registration owner');
        }
      };
      assertNetworkCurrent(); check();
      const authority = new WatchOnlyAuthority(view.accounts, options.reader, options.now, options.idle, options.historyReader, options.evmActivityReaders, view.utxoNetworks);
      authority.recordSession = { repository: Object.freeze({ load }), identity: view.identity, sources, assertNetworkCurrent };
      return authority;
    } catch { throw signal.aborted ? admissionCancelled() : new Error('Saved public accounts could not be opened'); }
    finally { signal.removeEventListener('abort', abort); }
  }

  private readonly idle?: { begin(): void; check(): boolean; stop(): void };
  private checkingIdle = false;

  constructor(
    accounts: readonly PublicAccount[],
    reader: BalanceReader,
    now: () => number = Date.now,
    idle?: { begin(): void; check(): boolean; stop(): void },
    historyReader?: UtxoActivityReader,
    evmActivityReaders?: EvmActivityReaders,
    registrations = UTXO_NETWORKS
  ) {
    this.idle = idle;
    this.utxoNetworks = registrations;
    this.accounts = validatePublicAccounts(accounts, registrations);
    this.reader = reader;
    this.historyReader = historyReader ? Object.freeze({ readPage: historyReader.readPage.bind(historyReader), readDetail: historyReader.readDetail.bind(historyReader), summaryBytes: historyReader.summaryBytes.bind(historyReader), forgetDetails: historyReader.forgetDetails.bind(historyReader) }) : undefined;
    this.evmActivityReaders = evmActivityReaders ? Object.freeze({
      explorer: Object.freeze({ page: evmActivityReaders.explorer.page.bind(evmActivityReaders.explorer) }),
      receipts: Object.freeze({ read: evmActivityReaders.receipts.read.bind(evmActivityReaders.receipts) }),
    }) : undefined;
    this.now = now;
    this.accountId = this.accounts[0]?.id ?? null;
    this.networkId = (Object.keys(this.accounts[0]?.addresses ?? {})[0] ??
      'ethereum') as NetworkId;
  }

  getNetwork = (id: NetworkId): WalletNetwork => getNetwork(id, this.utxoNetworks);
  getUtxoExplorer = (id: UtxoNetworkId): string => {
    if (isCustomUtxoNetworkId(id)) {
      if (!this.recordSession) throw new Error('Missing UTXO registration owner');
      this.recordSession.assertNetworkCurrent();
    }
    return getUtxoNetwork(id, this.utxoNetworks).explorer;
  };
  getAccountNetworks = (account: PublicAccount | undefined): readonly WalletNetwork[] => getWatchNetworks(account, this.utxoNetworks);

  getSnapshot(): PublicSnapshot {
    if (!this.locked && this.idle && !this.checkingIdle) { this.checkingIdle = true; try { if (!this.idle.check()) this.lock(); } finally { this.checkingIdle = false; } }
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const receive =
      !this.locked &&
      !!this.accounts.find((a) => a.id === this.accountId)?.addresses[
        this.networkId
      ];
    this.cachedSnapshot = Object.freeze({
      status: !this.accounts.length
        ? 'empty'
        : this.locked
        ? 'locked'
        : 'ready',
      accounts: this.accounts,
      selectedAccountId: this.accountId,
      selectedNetworkId: this.networkId,
      generation: this.generation,
      balance: this.balance,
      capabilities: Object.freeze({
        watchOnly: true,
        receive,
        send: false,
        createWallet: false,
        importRecoveryPhrase: false,
        biometrics: false,
        walletConnect: false,
      }),
    });
    return this.cachedSnapshot;
  }

  private currentSource(): AccountSource | undefined {
    const source = this.recordSession?.sources.get(this.accountId ?? '');
    return source?.networkId === this.networkId ? source : undefined;
  }
  subscribe(listener: (snapshot: PublicSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.cachedSnapshot = null;
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) {
      // A synchronous lock from an observer must not leak a stale ready state.
      if (this.cachedSnapshot !== snapshot) break;
      if (this.listeners.has(listener)) { try { listener(snapshot); } catch { /* Observers cannot interrupt revocation. */ } }
    }
  }

  private forgetUtxoRow(row: UtxoActivityRow): void {
    const charge = this.utxoRows.get(row); if (charge === undefined) return;
    this.utxoRows.delete(row); this.utxoSummaryBytes -= charge;
    this.historyReader?.forgetDetails([row]);
    const requests = this.utxoDetailRequests.get(row); this.utxoDetailRequests.delete(row);
    for (const request of requests ?? []) request.abort();
  }
  releaseUtxoActivity(): void {
    for (const request of this.utxoRequests) request.abort();
    this.utxoRequests.clear();
    for (const key of this.utxoRows.keys()) this.forgetUtxoRow(key);
    this.utxoDetails.dispose(); this.utxoDetails = createUtxoTransactionDetailsCache();
  }
  /** Drop-only admission follows the exact rows selected by the shared model. */
  retainUtxoActivityRows(rows: readonly UtxoActivityRow[]): void {
    if (rows.length > 100) throw new Error('Invalid activity window');
    const keep = new Set(rows);
    for (const row of this.utxoRows.keys()) if (!keep.has(row)) this.forgetUtxoRow(row);
  }

  private invalidate(): void {
    this.generation++;
    this.releaseUtxoActivity();
    for (const request of this.historyRequests) request.abort();
    this.historyRequests.clear();
    this.pending?.abort();
    this.pending = null;
    this.balance = Object.freeze({ status: 'unknown' });

  }

  /** Privacy lock only. It does not authenticate or unlock any signing key. */
  unlock(): void {
    if (!this.accounts.length) return;
    this.invalidate();
    this.idle?.begin();
    this.locked = false;
    this.publish();
  }

  /** Call on background/inactive as well as explicit lock. */
  lock(): void {
    this.idle?.stop();
    this.invalidate();
    this.locked = true;
    this.publish();
  }

  /** A departing public screen may cancel its read without locking the session. */
  cancelRefresh(): void {
    if (!this.pending) return;
    this.pending.abort();
    this.pending = null;
    this.balance = Object.freeze({ status: 'unknown' });
    this.publish();
  }

  /** Restore a saved public navigation hint without opening balances or custody. */
  restoreSelection(id: string): void {
    if (!this.locked) throw new Error('Selection restoration requires a locked view');
    const account = this.accounts.find((entry) => entry.id === id);
    if (!account) return;
    this.invalidate(); this.accountId = id;
    if (!account.addresses[this.networkId]) this.networkId = Object.keys(account.addresses)[0] as NetworkId;
    this.publish();
  }

  selectAccount(id: string): void {
    this.getSnapshot();
    if (this.locked) throw new Error('Wallet is locked');
    const account = this.accounts.find((entry) => entry.id === id);
    if (!account) throw new Error('Unknown account');
    this.invalidate();
    this.accountId = id;
    if (!account.addresses[this.networkId])
      this.networkId = Object.keys(account.addresses)[0] as NetworkId;
    this.publish();
  }

  selectNetwork(id: NetworkId): void {
    this.getSnapshot();
    if (this.locked) throw new Error('Wallet is locked');
    const network = this.getNetwork(id);
    if (
      !network.canWatch ||
      !this.accounts.find((a) => a.id === this.accountId)?.addresses[id]
    )
      throw new Error('This account has no address on that network');
    this.invalidate();
    this.networkId = id;
    this.publish();
  }

  async refresh(): Promise<void> {
    this.getSnapshot();
    if (this.locked) throw new Error('Wallet is locked');
    const account = this.accounts.find((entry) => entry.id === this.accountId);
    const address = account?.addresses[this.networkId];
    if (!account || !address) throw new Error('No active address');
    this.pending?.abort();
    const request = new AbortController();
    this.pending = request;
    const generation = this.generation;
    const network = this.getNetwork(this.networkId);
    this.balance = Object.freeze({ status: 'loading' });
    this.publish();
    try {
      if (request.signal.aborted || this.pending !== request || generation !== this.generation || this.locked) return;
      const source = this.currentSource(), session = this.recordSession;
      const registered = network.kind === 'utxo' && isCustomUtxoNetworkId(network.id) ? getUtxoNetwork(network.id, this.utxoNetworks) : undefined;
      if ((source || registered) && session) {
        const current = recordView(await session.repository.load());
        if (request.signal.aborted || this.pending !== request || generation !== this.generation || this.locked) return;
        if (current.identity !== session.identity) throw new Error('Saved watch accounts changed. Reopen them.');
      }
      const checkRegistration = session?.assertNetworkCurrent;
      if (registered && !session) throw new Error('Missing UTXO registration owner');
      checkRegistration?.();
      const response = source
        ? await this.reader.readUtxoAccount?.(registered ?? source.networkId, source.identifier, request.signal, checkRegistration)
        : network.kind === 'utxo'
          ? await this.reader.readUtxoBalance?.(registered ?? network.id, address, request.signal, checkRegistration)
          : await this.reader.readBalance(network.id, address, request.signal);
      checkRegistration?.();
      if (
        request.signal.aborted ||
        this.pending !== request ||
        generation !== this.generation ||
        this.locked
      )
        return;
      if (network.kind === 'utxo') {
        this.balance = utxoObservation(response as UtxoBalance, registered ?? network.id, this.now());
      } else {
        if (!response || 'kind' in response || response.chainId !== network.chainId)
          throw new Error('Network identity mismatch');
        this.balance = loadedBalance(response.units, this.now());
      }
    } catch {
      if (
        request.signal.aborted ||
        this.pending !== request ||
        generation !== this.generation ||
        this.locked
      )
        return;
      this.balance = Object.freeze({
        status: 'error',
        message: 'Balance unavailable. Try again.',
      });
    } finally {
      if (this.pending === request) {
        this.pending = null;
        this.publish();
      }
    }
  }

  /** One ownership boundary for public history; each async read rechecks saved records. */
  private async withActivityRead<T>(kind: 'utxo' | 'evm', external: AbortSignal | undefined,
    assertCurrent: () => void, action: (owner: { accountId: string; address: string; networkId: NetworkId; generation: number;
      source: AccountSource | undefined; recordIdentity: string; registration?: UtxoNetwork; assertNetworkCurrent?: () => void }, signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    const snapshot = this.getSnapshot();
    if (snapshot.status !== 'ready' || external?.aborted || this.getNetwork(this.networkId).kind !== kind) throw new Error('Account activity unavailable');
    const account = this.accounts.find((row) => row.id === this.accountId), networkId = this.networkId;
    const address = account?.addresses[networkId];
    if (!account || !address) throw new Error('Account activity unavailable');
    const generation = this.generation, session = this.recordSession, source = this.currentSource();
    const registration = kind === 'utxo' && isCustomUtxoNetworkId(networkId) ? getUtxoNetwork(networkId, this.utxoNetworks) : undefined;
    if (registration && !session) throw new Error('Missing UTXO registration owner');
    const request = new AbortController(); this.historyRequests.add(request); if (kind === 'utxo') this.utxoRequests.add(request);
    const abort = () => request.abort(); external?.addEventListener('abort', abort, { once: true });
    let stopped!: (reason: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { stopped = reject; });
    void cancelled.catch(() => undefined);
    const onAbort = () => stopped(new Error('Account activity cancelled'));
    request.signal.addEventListener('abort', onAbort, { once: true });
    const check = () => {
      this.getSnapshot();
      session?.assertNetworkCurrent();
      const result: unknown = assertCurrent();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
        throw new Error('Account activity cancelled');
      }
      if (external?.aborted || request.signal.aborted || this.locked || generation !== this.generation ||
          this.accountId !== account.id || this.networkId !== networkId || this.recordSession !== session) throw new Error('Account activity context changed');
    };
    const verifyRecords = async () => {
      check();
      if (session) {
        const observed = await Promise.race([session.repository.load(), cancelled]); check();
        let identity: string;
        try { identity = recordView(observed).identity; } catch (error) { if (kind === 'utxo') this.releaseUtxoActivity(); throw error; }
        if (identity !== session.identity) { if (kind === 'utxo') this.releaseUtxoActivity(); throw new Error('Saved public accounts changed. Reopen them.'); }
      }
    };
    try {
      check(); await verifyRecords(); check();
      const owner = { accountId: account.id, address, networkId, generation, source, registration,
        assertNetworkCurrent: session?.assertNetworkCurrent, recordIdentity: session?.identity ?? JSON.stringify(this.accounts) };
      const result = await Promise.race([action(owner, request.signal, check), cancelled]);
      check(); await verifyRecords(); check(); return result;
    } catch { throw new Error(request.signal.aborted ? 'Account activity cancelled' : 'Account activity unavailable'); }
    finally { external?.removeEventListener('abort', abort); request.signal.removeEventListener('abort', onAbort); this.historyRequests.delete(request); this.utxoRequests.delete(request); request.abort(); }
  }

  /** Read operation only: the canonical identifier never enters a public snapshot. */
  async readUtxoActivityPage(input: Readonly<{ page: number }>, external: AbortSignal): Promise<UtxoActivityPage> {
    const page = input.page, generation = this.generation, cache = this.utxoDetails;
    const reader = this.historyReader;
    if (!reader || !Number.isSafeInteger(page) || page < 1) throw new Error('Account activity unavailable');
    const checkAdmission = () => {
      if (external.aborted || this.generation !== generation || this.utxoDetails !== cache) throw new Error('Account activity cancelled');
    };
    checkAdmission();
    // Reserve at most twenty incoming row capabilities without dropping display rows.
    while (this.utxoRows.size > 100) {
      this.forgetUtxoRow(this.utxoRows.keys().next().value!);
      checkAdmission();
    }
    const result = await this.withActivityRead('utxo', external, () => undefined, async (owner, signal, check) => {
      const { accountId, address, networkId, generation, source, registration } = owner;
      const result = await reader.readPage({
        context: Object.freeze({ accountId, networkId: networkId as UtxoNetworkId, address, generation }),
        identifier: source?.identifier ?? address, isAccount: !!source,
        ...(registration ? { registration, assertCurrent: check } : {}),
      }, { page }, signal);
      check();
      if (result.context.accountId !== accountId || result.context.networkId !== networkId || result.context.address !== address || result.context.generation !== generation || result.page !== page)
        throw new Error('Account activity context changed');
      return result;
    });
    const admitted: UtxoActivityRow[] = [];
    try {
      if (this.getSnapshot().status !== 'ready') throw new Error('Account activity cancelled');
      checkAdmission();
      for (const row of result.rows) {
        if (this.utxoRows.has(row)) continue;
        const charge = reader.summaryBytes(row);
        checkAdmission();
        if (charge === null || charge > UTXO_DETAIL_CACHE_BYTES) { reader.forgetDetails([row]); continue; }
        while (this.utxoRows.size && (this.utxoRows.size >= 120 || this.utxoSummaryBytes + charge > UTXO_DETAIL_CACHE_BYTES)) {
          this.forgetUtxoRow(this.utxoRows.keys().next().value!);
          // Aborting an evicted detail can synchronously revoke this context.
          checkAdmission();
        }
        // Duplicate txids can carry different facts. The shared model chooses
        // the actual representative before drop-only capability pruning.
        this.utxoRows.set(row, charge); this.utxoSummaryBytes += charge;
        admitted.push(row);
      }
      checkAdmission();
      return result;
    } catch (error) {
      for (const row of admitted) {
        if (this.generation !== generation || this.utxoDetails !== cache) break;
        this.forgetUtxoRow(row);
      }
      reader.forgetDetails(result.rows);
      throw error;
    }
  }

  async readUtxoActivityDetail(input: Readonly<{ txid: string }>, external: AbortSignal): Promise<UtxoActivityDetail> {
    const txid = input.txid;
    if (!this.historyReader || typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) throw new Error('Account activity unavailable');
    const key = txid.toLowerCase(), cache = this.utxoDetails;
    const row = [...this.utxoRows.keys()].find(row => row.txid === key);
    if (!row) throw new Error('Account activity unavailable');
    const generation = this.generation, operation = new AbortController();
    const abort = () => operation.abort();
    external.addEventListener('abort', abort, { once: true });
    if (external.aborted) abort();
    const requests = this.utxoDetailRequests.get(row) ?? new Set<AbortController>();
    requests.add(operation); this.utxoDetailRequests.set(row, requests);
    try {
      const result = await this.withActivityRead('utxo', operation.signal, () => undefined, async (owner, signal, check) => {
        const current = () => { check(); if (this.utxoDetails !== cache || !this.utxoRows.has(row)) throw new Error('Account activity context changed'); };
        current();
        const { accountId, address, networkId, source, generation, registration } = owner;
        const value = await this.historyReader!.readDetail({ context: Object.freeze({ accountId, address, networkId: networkId as UtxoNetworkId, generation }),
          identifier: source?.identifier ?? address, isAccount: !!source,
          // The physical cached fetch can have multiple viewers. Its owner is
          // the saved registration; the separate callback below owns this viewer.
          ...(registration ? { registration, assertCurrent: owner.assertNetworkCurrent } : {}) }, { row, txid: key }, signal, cache, current);
        current(); return value;
      });
      const assertDetailCurrent = () => {
        if (this.getSnapshot().status !== 'ready' || this.generation !== generation || this.utxoDetails !== cache || !this.utxoRows.has(row))
          throw new Error('Account activity cancelled');
      };
      if (operation.signal.aborted) throw new Error('Account activity cancelled');
      assertDetailCurrent();
      const readNode = result.readSentryNode;
      return readNode ? Object.freeze({ ...result,
        readSentryNode: (signal: AbortSignal, guard: () => void) =>
          this.withActivityRead('utxo', signal, () => { assertDetailCurrent(); return guard(); },
            (_owner, ownedSignal, check) => readNode(ownedSignal, check)),
      }) : result;
    } finally {
      external.removeEventListener('abort', abort); requests.delete(operation);
      if (!requests.size && this.utxoDetailRequests.get(row) === requests) this.utxoDetailRequests.delete(row);
      operation.abort();
    }
  }

  private evmScope(owner: { accountId: string; address: string; networkId: NetworkId; recordIdentity: string }): EvmActivityReadScope {
    const network = getNativeNetwork(owner.networkId);
    const key = keccak256(toUtf8Bytes(JSON.stringify(['public-watch', owner.recordIdentity, owner.accountId, owner.address, network.chainId])));
    return createActivityReadScope(key, owner.address, network);
  }
  private async withEvmActivity<T>(expected: EvmActivityReadScope | undefined, signal: AbortSignal | undefined,
    guard: () => void, action: (scope: EvmActivityReadScope, signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    const expectedKey = expected?.key, expectedSource = expected?.sourceId, expectedRegistration = expected?.network.registrationHash;
    return this.withActivityRead('evm', signal, guard, async (owner, currentSignal, check) => {
      const scope = this.evmScope(owner);
      if (expected && (scope.key !== expectedKey || scope.sourceId !== expectedSource || scope.network.registrationHash !== expectedRegistration))
        throw new Error('Account activity context changed');
      return action(scope, currentSignal, check);
    });
  }
  loadEvmActivity(guard: () => void, signal?: AbortSignal): Promise<EvmActivityReadScope> {
    return this.withEvmActivity(undefined, signal, guard, async (scope) => scope);
  }
  readEvmActivityPage(scope: EvmActivityReadScope, feed: ActivityFeed, page: number, signal: AbortSignal, guard: () => void) {
    if (feed !== 'txlist' && feed !== 'tokentx') return Promise.reject(new Error('Account activity unavailable'));
    if (!this.evmActivityReaders) return Promise.reject(new Error('Account activity unavailable'));
    return this.withEvmActivity(scope, signal, guard, (current, currentSignal, check) => this.evmActivityReaders!.explorer.page(current, feed, page, currentSignal, check));
  }
  readEvmActivityTransaction(scope: EvmActivityReadScope, hash: string, signal: AbortSignal, guard: () => void) {
    if (!this.evmActivityReaders) return Promise.reject(new Error('Account activity unavailable'));
    return this.withEvmActivity(scope, signal, guard, (current, currentSignal, check) => this.evmActivityReaders!.receipts.read(hash, current.address, currentSignal, check, current.network));
  }

  async prepareTransfer(_intent: TransferIntent): Promise<TransferReview> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }

  async confirmTransfer(_review: TransferReview): Promise<SubmissionStatus> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }
}
