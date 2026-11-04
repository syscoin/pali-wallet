import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { normalizePublicAddress } from './addresses.ts';
import { loadedBalance } from './amounts.ts';
import { getNetwork, NETWORKS } from './networks.ts';
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

export interface BalanceReader {
  /** Implementations must verify the connected chain before returning an observation. */
  readBalance(
    networkId: NetworkId,
    address: string,
    signal: AbortSignal
  ): Promise<{ chainId: number; units: string }>;
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
        Object.keys(raw).some(
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
    });
    return this.cachedSnapshot;
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
    this.locked = false;
    this.publish();
  }

  /** Call on background/inactive as well as explicit lock. */
  lock(): void {
    this.invalidate();
    this.locked = true;
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
      const response = await this.reader.readBalance(
        network.id,
        address,
        request.signal
      );
      if (
        request.signal.aborted ||
        this.pending !== request ||
        generation !== this.generation ||
        this.locked
      )
        return;
      if (response.chainId !== network.chainId)
        throw new Error('Network identity mismatch');
      this.balance = loadedBalance(response.units, this.now());
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
