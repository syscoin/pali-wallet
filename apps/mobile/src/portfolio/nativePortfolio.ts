import { findUtxoNetwork } from '../core/utxoNetworks.ts';
import { utxoObservation } from '../core/utxoBalance.ts';
import type { UtxoSptBalance } from '../core/utxoBalanceReader.ts';
import { normalizePublicAddress } from '../core/addresses.ts';
import { getNativeNetwork } from '../custody/networkContext.ts';
import type { EvmNetworkId } from '../custody/networkContext.ts';
import { assertBaseUnits } from '../core/amounts.ts';
import type { BalanceReader } from '../core/watchOnlyAuthority.ts';
import type { CustodySnapshot } from '../custody/types.ts';

export type NativePortfolioAccount = Readonly<{
  address: string;
  network: EvmNetworkId;
  revision: number;
}>;

type PortfolioSpt = Readonly<{ status: 'available'; holdings: readonly UtxoSptBalance[] } | { status: 'unavailable' }>;
const SPT_UNAVAILABLE = Object.freeze({ status: 'unavailable' as const });

export type NativePortfolioSnapshot = Readonly<{
  account: NativePortfolioAccount | null;
  status: 'unavailable' | 'unknown' | 'loading' | 'available' | 'error';
  units: string | null;
  updatedAt: number | null;
  pendingDeltaUnits?: string;
  assets?: PortfolioSpt;
}>;

/** Only the custody authority's public projection crosses this boundary. */
export interface PublicCustodySource {
  getSnapshot(): CustodySnapshot;
  getCatalogue?(): import('../custody/walletCatalogue.ts').NativeWalletCatalogueSnapshot | null;
  subscribe(listener: (snapshot: CustodySnapshot) => void): () => void;
}

type Connection = object;
type Request = {
  account: NativePortfolioAccount;
  connection: Connection;
  controller: AbortController;
  generation: number;
};

export function sameNativePortfolioAccount(
  left: NativePortfolioAccount | null,
  right: NativePortfolioAccount | null
): boolean {
  return left === right || Boolean(
    left && right && left.address === right.address &&
    left.network === right.network && left.revision === right.revision
  );
}

function snapshot(
  account: NativePortfolioAccount | null,
  status: NativePortfolioSnapshot['status'],
  units: string | null = null,
  updatedAt: number | null = null,
  pendingDeltaUnits?: string,
  assets?: PortfolioSpt
): NativePortfolioSnapshot {
  return Object.freeze({ account, status, units, updatedAt, ...(pendingDeltaUnits === undefined ? {} : { pendingDeltaUnits }), ...(assets ? { assets } : {}) });
}

/** Public balance observations, bound to an authenticated custody revision. Backup-required remains read-only. */
export class NativePortfolioController {
  private readonly source: PublicCustodySource;
  private readonly reader: BalanceReader;
  private readonly now: () => number;
  private state = snapshot(null, 'unavailable');
  private listeners = new Set<(value: NativePortfolioSnapshot) => void>();
  private connection: Connection | null = null;
  private unsubscribeSource: (() => void) | null = null;
  private pending: Request | null = null;
  private generation = 0;
  private unpublished = false;

  constructor(source: PublicCustodySource, reader: BalanceReader, now = Date.now) {
    this.source = source;
    this.reader = reader;
    this.now = now;
  }

  getNetworkRegistration(id: string) { return getNativeNetwork(id, this.source.getCatalogue?.()?.networks); }
  getUtxoNetwork(id: unknown) { return findUtxoNetwork(id, this.source.getCatalogue?.()?.utxoNetworks); }

  private readAccount(): NativePortfolioAccount | null {
    try {
      const current = this.source.getSnapshot();
      if (
        current.phase !== 'ready' || !current.account ||
        !Number.isSafeInteger(current.revision) || current.revision < 0
      ) return null;
      const network = this.getUtxoNetwork(current.account.network) ??
        getNativeNetwork(current.account.network, this.source.getCatalogue?.()?.networks);
      return Object.freeze({
        address: normalizePublicAddress(current.account.address, network.id, this.source.getCatalogue?.()?.utxoNetworks),
        network: network.id as EvmNetworkId,
        revision: current.revision,
      });
    } catch {
      return null;
    }
  }

  private cancel(): void {
    ++this.generation;
    const pending = this.pending;
    this.pending = null;
    pending?.controller.abort();
  }

  private emit(): void {
    this.unpublished = false;
    const current = this.state;
    for (const listener of [...this.listeners]) {
      // A listener may synchronously lock, reconnect or request a refresh.
      if (this.state !== current) break;
      if (!this.listeners.has(listener)) continue;
      try { listener(current); } catch { /* Observers cannot break revocation. */ }
    }
  }

  private replace(value: NativePortfolioSnapshot, notify: boolean): void {
    this.state = value;
    this.unpublished = true;
    if (notify) this.emit();
  }

  private synchronize(notify: boolean): boolean {
    const account = this.connection ? this.readAccount() : null;
    const changed = !sameNativePortfolioAccount(this.state.account, account);
    if (changed) {
      this.cancel();
      this.replace(snapshot(account, account ? 'unknown' : 'unavailable'), notify);
    } else if (notify && this.unpublished) {
      this.emit();
    }
    return changed;
  }

  /** Revalidation clears stale public data, but never starts IO during render. */
  getSnapshot = (): NativePortfolioSnapshot => {
    this.synchronize(false);
    return this.state;
  };

  subscribe = (listener: (value: NativePortfolioSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getActiveAccount = (): NativePortfolioAccount | null => {
    this.synchronize(false);
    return this.state.account;
  };

  isCurrent = (account: NativePortfolioAccount | null): boolean => {
    this.synchronize(false);
    return Boolean(this.connection && account && sameNativePortfolioAccount(this.state.account, account));
  };

  private sourceChanged(connection: Connection): void {
    if (this.connection !== connection) return;
    this.synchronize(true);
    if (
      this.connection === connection && this.state.account &&
      this.state.status === 'unknown'
    ) void this.refresh();
  }

  /** Each cleanup belongs only to its connection, including Strict Mode replay. */
  connect = (): (() => void) => {
    const previousUnsubscribe = this.unsubscribeSource;
    const connection = {};
    this.connection = connection;
    this.unsubscribeSource = null;
    this.cancel();
    this.replace(snapshot(null, 'unavailable'), false);
    try { previousUnsubscribe?.(); } catch { /* Remain fail closed. */ }
    if (this.connection !== connection) return () => undefined;
    try {
      const unsubscribe = this.source.subscribe(() => this.sourceChanged(connection));
      if (this.connection !== connection) {
        unsubscribe();
        return () => undefined;
      }
      this.unsubscribeSource = unsubscribe;
    } catch {
      this.connection = null;
      this.cancel();
      this.replace(snapshot(null, 'unavailable'), true);
      return () => undefined;
    }
    this.sourceChanged(connection);
    return () => {
      if (this.connection !== connection) return;
      this.connection = null;
      const unsubscribe = this.unsubscribeSource;
      this.unsubscribeSource = null;
      this.cancel();
      this.replace(snapshot(null, 'unavailable'), false);
      try { unsubscribe?.(); } catch { /* Cleanup still clears the public view. */ }
      this.emit();
    };
  };

  private current(request: Request): boolean {
    // Read authority state again: its notification may be delayed or reordered.
    this.synchronize(true);
    return this.connection === request.connection &&
      this.pending === request && this.generation === request.generation &&
      !request.controller.signal.aborted && sameNativePortfolioAccount(this.state.account, request.account);
  }

  refresh = async (): Promise<void> => {
    const connection = this.connection;
    if (!connection) return;
    this.synchronize(true);
    const account = this.state.account;
    if (!account || this.connection !== connection) return;
    const previouslyObservedAssets = this.state.assets ? SPT_UNAVAILABLE : undefined;
    this.cancel();
    const request: Request = {
      account, connection, controller: new AbortController(), generation: this.generation,
    };
    this.pending = request;
    this.replace(snapshot(account, 'loading', null, null, undefined, previouslyObservedAssets), true);
    if (!this.current(request)) return;
    try {
      const network = this.getUtxoNetwork(account.network);
      if (network) {
        const result = await this.reader.readUtxoBalance?.(network.id, account.address, request.controller.signal);
        if (!this.current(request)) return;
        if (!result) throw new Error('Invalid observation');
        const balance = utxoObservation(result, network, this.now());
        if (!this.current(request)) return;
        let assets: PortfolioSpt | undefined = previouslyObservedAssets;
        if (balance.assets) {
          assets = Object.freeze({ status: 'available', holdings: Object.freeze(balance.assets.filter(item => item.confirmedUnits !== '0' || item.pendingDeltaUnits !== '0')) });
        }
        this.pending = null;
        this.replace(snapshot(account, 'available', balance.units, balance.updatedAt, balance.pendingDeltaUnits, assets), true);
        return;
      }
      const result = await this.reader.readBalance(account.network, account.address, request.controller.signal);
      if (!this.current(request)) return;
      if (!result) throw new Error('Invalid observation');
      const { chainId, units } = result;
      if (chainId !== Number(this.getNetworkRegistration(account.network).chainId)) throw new Error('Invalid chain');
      assertBaseUnits(units);
      const updatedAt = this.now();
      if (!Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('Invalid time');
      if (!this.current(request)) return;
      this.pending = null;
      this.replace(snapshot(account, 'available', units, updatedAt), true);
    } catch {
      if (!this.current(request)) return;
      this.pending = null;
      // Untrusted transport error text never reaches public state.
      this.replace(snapshot(account, 'error', null, null, undefined, previouslyObservedAssets), true);
    }
  };
}
