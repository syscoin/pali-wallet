import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { normalizePublicAddress } from './addresses.ts';
import { assertBaseUnits, loadedBalance } from './amounts.ts';
import { getNetwork, NETWORKS } from './networks.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import type { UtxoBalance } from './utxoBalanceReader.ts';
import { Bip84Discovery, type Bip84DiscoverySnapshot, type PublicBip84Deriver } from './bip84Discovery.ts';
import type { UtxoAddressUsageReader } from './utxoAddressUsage.ts';
import type { WatchRecordRepository, WatchRecordSnapshot } from './publicAccountStorage.ts';
import { snapshotWatchRecords, type StoredWatchAccount } from './watchAccountCodec.ts';
import type {
  NetworkId,
  PublicAccount,
  PublicBalance,
  PublicSnapshot,
  PublicAccountObservation,
  SubmissionStatus,
  TransferIntent,
  TransferReview,
  WalletAuthority,
  WalletNetwork,
} from './types.ts';

type BoundSource = Readonly<{ derive(request: Readonly<{ branch: 0 | 1; index: number }>): Readonly<{ address: string; branch: 0 | 1; index: number }> }>;
type RecordOpenOptions = Readonly<{
  repository: WatchRecordRepository; reader: BalanceReader; usageReader: UtxoAddressUsageReader;
  bindPublicAccount(request: Readonly<{ networkId: UtxoNetworkId; canonicalKey: string }>): BoundSource;
  signal: AbortSignal; now?: () => number;
}>;
type AccountSource = Readonly<{ record: Extract<StoredWatchAccount, { kind: 'bip84-public' }>; derive: PublicBip84Deriver }>;
type RecordSession = {
  repository: WatchRecordRepository; snapshot: WatchRecordSnapshot; identity: string;
  sources: ReadonlyMap<string, AccountSource>; usageReader: UtxoAddressUsageReader;
  operation: AbortController | null; scanner: { source: AccountSource; value: Bip84Discovery } | null;
  guard: (() => void) | null;
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
  const data = ownFields(snapshot, ['version', 'records', 'accounts']);
  if (data.version !== 1 && data.version !== 2) throw new Error('Invalid public account record version');
  const records = snapshotWatchRecords(data.records), accounts = validatePublicAccounts(data.accounts);
  if (records.length !== accounts.length || records.some((record, i) => record.id !== accounts[i]?.id || record.name !== accounts[i]?.name ||
    record.kind === 'address' && JSON.stringify(record.addresses) !== JSON.stringify(accounts[i]?.addresses))) throw new Error('Public account projection changed');
  return { records, accounts, identity: JSON.stringify({ version: data.version, records, accounts }) };
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
  readUtxoBalance?(networkId: UtxoNetworkId, address: string, signal: AbortSignal): Promise<UtxoBalance>;
}

/** Untrusted persisted public data must not import private keyring records. */
export function validatePublicAccounts(
  input: unknown
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
      const utxo = networkIds.filter((id) => getNetwork(id as NetworkId).kind === 'utxo');
      if (utxo.length && (utxo.length !== 1 || networkIds.length !== 1))
        throw new Error('A UTXO watch account has exactly one network and address');
      const normalized: Partial<Record<NetworkId, string>> = {};
      for (const [networkId, address] of Object.entries(addresses)) {
        if (typeof address !== 'string')
          throw new Error('Invalid public address');
        normalized[networkId as NetworkId] = normalizePublicAddress(
          address,
          networkId as NetworkId
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
export function createWatchAccount(id: string, name: string, address: string, network: WatchAccountNetwork = 'evm'): PublicAccount {
  if (network === 'evm') return createEvmWatchAccount(id, name, address);
  const fixed = getUtxoNetwork(network);
  return validatePublicAccounts([{ id, name, addresses: { [fixed.id]: normalizePublicAddress(address, fixed.id) } }])[0]!;
}

function utxoObservation(value: UtxoBalance, networkId: UtxoNetworkId, updatedAt: number): PublicBalance {
  assertJsonWorkBudget(value, 2048, 3, 30);
  const network = getUtxoNetwork(networkId);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== 8 || Object.keys(value).length !== 8 || Object.keys(value).some((key) => ![
        'networkId', 'kind', 'chainId', 'genesisHash', 'confirmedUnits', 'pendingDeltaUnits', 'unconfirmedTransactions', 'observedHeight',
      ].includes(key)) || value.kind !== 'utxo' || value.networkId !== network.id || value.chainId !== network.chainId ||
      value.genesisHash !== network.genesisHash || typeof value.pendingDeltaUnits !== 'string' ||
      !/^(?:0|-?[1-9][0-9]{0,77})$/.test(value.pendingDeltaUnits) ||
      !Number.isSafeInteger(value.unconfirmedTransactions) || value.unconfirmedTransactions < 0 ||
      !Number.isSafeInteger(value.observedHeight) || value.observedHeight < 0)
    throw new Error('Invalid UTXO balance observation');
  assertBaseUnits(value.confirmedUnits);
  assertBaseUnits(value.pendingDeltaUnits.replace(/^-/, ''));
  if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('Invalid UTXO balance time');
  return Object.freeze({ status: 'available', kind: 'utxo', units: value.confirmedUnits, updatedAt,
    pendingDeltaUnits: value.pendingDeltaUnits, unconfirmedTransactions: value.unconfirmedTransactions, observedHeight: value.observedHeight });
}

/** Existing records retain their explicit address mappings; missing networks are never inferred. */
export function getWatchNetworks(account: PublicAccount | undefined): readonly WalletNetwork[] {
  return Object.freeze(NETWORKS.filter((network) => network.canWatch && !!account?.addresses[network.id]));
}

export class WatchOnlyAuthority implements WalletAuthority {
  private readonly accounts: readonly PublicAccount[];
  private readonly reader: BalanceReader;
  private readonly now: () => number;
  private listeners = new Set<(snapshot: PublicSnapshot) => void>();
  private generation = 0;
  private accountId: string | null;
  private networkId: NetworkId;
  private locked = true;
  private balance: PublicBalance = Object.freeze({ status: 'unknown' });
  private pending: AbortController | null = null;
  private cachedSnapshot: PublicSnapshot | null = null;
  private recordSession: RecordSession | null = null;
  private observation: PublicAccountObservation | null = null;

  /** Internal factory only; storage/SDK ports are not composed by production yet. */
  static async openRecords(options: RecordOpenOptions): Promise<WatchOnlyAuthority> {
    const load = ownFunction(options.repository, 'load') as WatchRecordRepository['load'];
    const save = ownFunction(options.repository, 'saveCheckpoint') as WatchRecordRepository['saveCheckpoint'];
    const open = ownFunction(options.usageReader, 'open') as UtxoAddressUsageReader['open'];
    const bind = ownFunction(options, 'bindPublicAccount') as RecordOpenOptions['bindPublicAccount'];
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
        if (record.kind !== 'bip84-public') continue;
        check();
        const output: unknown = bind(Object.freeze({ networkId: record.networkId, canonicalKey: record.accountKey }));
        if (output instanceof Promise) { void output.catch(() => undefined); throw new Error('Public binding must be synchronous'); }
        const method = ownFields(output, ['derive']).derive;
        if (typeof method !== 'function') throw new Error('Invalid public derivation binding');
        const derive: PublicBip84Deriver = (request) => {
          if (request.networkId !== record.networkId) throw new Error('Public derivation network changed');
          const result: unknown = method(Object.freeze({ branch: request.branch, index: request.index }));
          if (result instanceof Promise) { void result.catch(() => undefined); throw new Error('Public derivation must be synchronous'); }
          const data = ownFields(result, ['address', 'branch', 'index']);
          if (data.branch !== request.branch || data.index !== request.index) throw new Error('Public derivation index changed');
          return Object.freeze({ branch: request.branch, index: request.index, address: normalizePublicAddress(data.address as string, record.networkId) });
        };
        const first = derive({ networkId: record.networkId, branch: 0, index: 0 }); check();
        const projection = view.accounts.find((account) => account.id === record.id)!;
        if (Object.keys(projection.addresses).length !== 1 || projection.addresses[record.networkId] !== first.address) throw new Error('Public first address does not match stored projection');
        sources.set(record.id, Object.freeze({ record, derive }));
      }
      check();
      const authority = new WatchOnlyAuthority(view.accounts, options.reader, options.now);
      authority.recordSession = { repository: Object.freeze({ load, saveCheckpoint: save }), snapshot, identity: view.identity,
        sources, usageReader: Object.freeze({ open }), operation: null, scanner: null, guard: null };
      return authority;
    } catch { throw signal.aborted ? admissionCancelled() : new Error('Saved public accounts could not be opened'); }
    finally { signal.removeEventListener('abort', abort); }
  }

  constructor(
    accounts: readonly PublicAccount[],
    reader: BalanceReader,
    now: () => number = Date.now
  ) {
    this.accounts = validatePublicAccounts(accounts);
    this.reader = reader;
    this.now = now;
    this.accountId = this.accounts[0]?.id ?? null;
    this.networkId = (Object.keys(this.accounts[0]?.addresses ?? {})[0] ??
      'ethereum') as NetworkId;
  }

  getSnapshot(): PublicSnapshot {
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
      ...(this.currentSource() ? { accountObservation: this.publicObservation(this.currentSource()!) } : {}),
    });
    return this.cachedSnapshot;
  }

  private currentSource(): AccountSource | undefined {
    const source = this.recordSession?.sources.get(this.accountId ?? '');
    return source?.record.networkId === this.networkId ? source : undefined;
  }
  private publicObservation(source: AccountSource): PublicAccountObservation {
    const value = this.observation ?? this.observed(source, 'unknown');
    return Object.freeze({ ...value, canContinue: !this.locked && !this.recordSession?.operation &&
      value.status === 'partial' && value.reason === 'pass-limit' && !!this.recordSession?.scanner });
  }
  private observed(source: AccountSource, status: PublicAccountObservation['status'], result?: Bip84DiscoverySnapshot): PublicAccountObservation {
    return Object.freeze({ kind: 'bip84-public', accountId: source.record.id, networkId: source.record.networkId,
      policy: 'bip84-p2wpkh', status, reason: result?.reason === 'pass-limit' || result?.reason === 'index-limit' ? result.reason : status === 'unavailable' ? 'read-failed' : null,
      totals: result?.totals ?? null, coverage: result ? Object.freeze(result.cursor.branches.map((branch) => Object.freeze({ ...branch }))) : null,
      observedAddresses: result?.observedAddresses ?? 0, observedThisPass: result?.observedThisPass ?? 0,
      observationsSpanPasses: result?.observationsSpanPasses ?? false, anchor: result?.anchor ?? null, canContinue: false });
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

  private invalidate(): void {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
    this.balance = Object.freeze({ status: 'unknown' });
    this.recordSession?.operation?.abort();
    this.recordSession?.scanner?.value.cancel();
    if (this.recordSession) { this.recordSession.scanner = null; this.recordSession.guard = null; }
    this.observation = null;
  }

  /** Privacy lock only. It does not authenticate or unlock any signing key. */
  unlock(): void {
    if (!this.accounts.length) return;
    this.invalidate();
    this.locked = false;
    this.publish();
  }

  /** Call on background/inactive as well as explicit lock. */
  lock(): void {
    this.invalidate();
    this.locked = true;
    this.publish();
  }

  /** A departing public screen may cancel its read without locking the session. */
  cancelRefresh(): void {
    if (!this.pending && !this.recordSession?.operation && !this.recordSession?.scanner) return;
    this.invalidate();
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
    if (this.locked) throw new Error('Wallet is locked');
    const network = getNetwork(id);
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
    if (this.locked) throw new Error('Wallet is locked');
    if (this.currentSource()) return this.refreshAccount('refresh');
    const account = this.accounts.find((entry) => entry.id === this.accountId);
    const address = account?.addresses[this.networkId];
    if (!account || !address) throw new Error('No active address');
    this.pending?.abort();
    const request = new AbortController();
    this.pending = request;
    const generation = this.generation;
    const network = getNetwork(this.networkId);
    this.balance = Object.freeze({ status: 'loading' });
    this.publish();
    try {
      const isUtxo = network.id === 'syscoin' || network.id === 'bitcoin';
      const response = isUtxo
        ? await this.reader.readUtxoBalance?.(network.id as UtxoNetworkId, address, request.signal)
        : await this.reader.readBalance(network.id, address, request.signal);
      if (
        request.signal.aborted ||
        this.pending !== request ||
        generation !== this.generation ||
        this.locked
      )
        return;
      if (isUtxo) {
        this.balance = utxoObservation(response as UtxoBalance, network.id as UtxoNetworkId, this.now());
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

  /** Only a same-context live partial scan can continue; persisted hints never skip work. */
  async continueDiscovery(): Promise<void> {
    return this.refreshAccount('resume');
  }
  private async refreshAccount(mode: 'refresh' | 'resume'): Promise<void> {
    const session = this.recordSession, source = this.currentSource();
    if (this.locked) throw new Error('Wallet is locked');
    if (!session || !source) throw new Error('Account discovery is unavailable');
    if (session.operation) throw new Error('Account discovery is already in progress');
    if (mode === 'resume' && (session.scanner?.source !== source || session.scanner.value.getSnapshot().status !== 'partial' ||
        session.scanner.value.getSnapshot().reason !== 'pass-limit')) throw new Error('No live partial discovery to continue');
    const request = new AbortController(), generation = this.generation;
    session.operation = request; this.pending = request;
    const current = () => this.recordSession === session && session.operation === request && this.pending === request &&
      !request.signal.aborted && !this.locked && this.generation === generation && this.currentSource() === source;
    const check = () => { if (!current()) throw new Error('Account discovery was cancelled'); };
    session.guard = check;
    this.observation = this.observed(source, 'loading'); this.balance = Object.freeze({ status: 'unknown' });
    this.publish();
    try {
      check(); const snapshot = await session.repository.load(); check();
      const before = recordView(snapshot);
      if (before.identity !== session.identity) throw new Error('Saved watch accounts changed. Reopen them.');
      session.snapshot = snapshot;
      if (mode === 'refresh') {
        session.scanner?.value.cancel();
        const scanner: Bip84Discovery = new Bip84Discovery({ scope: { networkId: source.record.networkId, sourceId: source.record.id },
          derive: source.derive, reader: session.usageReader, restoredCursor: source.record.checkpoint ?? undefined,
          assertCurrent: () => { if (session.scanner?.value !== scanner || !session.guard) throw new Error('Stale discovery'); session.guard(); } });
        session.scanner = { source, value: scanner };
      }
      check();
      const result = await session.scanner!.value.scan(mode); check();
      const saved = await session.repository.saveCheckpoint(snapshot, source.record.id, result.cursor, check); check();
      const view = recordView(saved);
      const expectedRecords = before.records.map((record) => record.id === source.record.id ? { ...record, checkpoint: result.cursor } : record);
      if (JSON.stringify(view.accounts) !== JSON.stringify(this.accounts) || JSON.stringify(view.records) !== JSON.stringify(expectedRecords))
        throw new Error('Public account source changed');
      session.snapshot = saved; session.identity = view.identity;
      this.observation = this.observed(source, result.status === 'gap-reached' ? 'gap-reached' : 'partial', result);
    } catch {
      session.scanner?.value.cancel(); session.scanner = null;
      if (current()) this.observation = this.observed(source, 'unavailable');
    } finally {
      const publish = current();
      if (session.operation === request) { session.operation = null; session.guard = null; }
      if (this.pending === request) this.pending = null;
      if (publish) this.publish();
    }
  }

  async prepareTransfer(_intent: TransferIntent): Promise<TransferReview> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }

  async confirmTransfer(_review: TransferReview): Promise<SubmissionStatus> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }
}
