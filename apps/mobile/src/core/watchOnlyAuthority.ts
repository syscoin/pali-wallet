import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { normalizePublicAddress } from './addresses.ts';
import { assertBaseUnits, loadedBalance } from './amounts.ts';
import { getNetwork, NETWORKS } from './networks.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
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
  repository: Pick<WatchRecordRepository, 'load'>; reader: BalanceReader;
  signal: AbortSignal; now?: () => number;
  idle?: { begin(): void; check(): boolean; stop(): void };
}>;
type AccountSource = Extract<StoredWatchAccount, { kind: 'utxo-public' }>;
type RecordSession = {
  repository: Pick<WatchRecordRepository, 'load'>; identity: string;
  sources: ReadonlyMap<string, AccountSource>;
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
  if (data.version !== 1) throw new Error('Invalid public account record version');
  const decoded = createWatchAccountCodec().validate(data.records), records = decoded.records;
  const accounts = validatePublicAccounts(data.accounts);
  if (JSON.stringify(decoded.accounts) !== JSON.stringify(accounts)) throw new Error('Public account projection changed');
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
  readUtxoAccount?(networkId: UtxoNetworkId, identifier: string, signal: AbortSignal): Promise<UtxoBalance>;
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

  /** Open the canonical saved records; public snapshots expose addresses only. */
  static async openRecords(options: RecordOpenOptions): Promise<WatchOnlyAuthority> {
    const load = ownFunction(options.repository, 'load') as WatchRecordRepository['load'];
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
      const authority = new WatchOnlyAuthority(view.accounts, options.reader, options.now, options.idle);
      authority.recordSession = { repository: Object.freeze({ load }), identity: view.identity, sources };
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
    idle?: { begin(): void; check(): boolean; stop(): void }
  ) {
    this.idle = idle;
    this.accounts = validatePublicAccounts(accounts);
    this.reader = reader;
    this.now = now;
    this.accountId = this.accounts[0]?.id ?? null;
    this.networkId = (Object.keys(this.accounts[0]?.addresses ?? {})[0] ??
      'ethereum') as NetworkId;
  }

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

  private invalidate(): void {
    this.generation++;
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
    this.getSnapshot();
    if (this.locked) throw new Error('Wallet is locked');
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
      if (request.signal.aborted || this.pending !== request || generation !== this.generation || this.locked) return;
      const isUtxo = network.id === 'syscoin' || network.id === 'bitcoin';
      const source = this.currentSource(), session = this.recordSession;
      if (source && session) {
        const current = recordView(await session.repository.load());
        if (request.signal.aborted || this.pending !== request || generation !== this.generation || this.locked) return;
        if (current.identity !== session.identity) throw new Error('Saved watch accounts changed. Reopen them.');
      }
      const response = source
        ? await this.reader.readUtxoAccount?.(source.networkId, source.identifier, request.signal)
        : isUtxo
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

  async prepareTransfer(_intent: TransferIntent): Promise<TransferReview> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }

  async confirmTransfer(_review: TransferReview): Promise<SubmissionStatus> {
    throw new Error('SIGNING_UNAVAILABLE: This is a watch-only account');
  }
}
