import type { DappWalletControlRequest } from '../../../../source/shared/dappWalletControl.ts';
import { EthereumRpcErrorHandler } from '../../../../source/helpers/errors/errorClassesHandlers.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { NativeCatalogueAccount } from '../custody/walletCatalogue.ts';
import type { DappModeRequest } from '../../../../source/shared/dappChainScope.ts';
import { requiresDappModeSwitch } from '../../../../source/shared/dappChainScope.ts';
import type {
  WalletConnectRequest,
  WalletConnectVerification,
} from './walletConnect.ts';
export type NativeDappControlRequest = DappWalletControlRequest | DappModeRequest;

export type NativeDappControlDetails = Readonly<
  | {
      kind: 'network-switch' | 'network-add';
      chainId: string;
      name: string;
      rpcUrl: string;
      symbol: string;
    }
  | {
      kind: 'watch-asset';
      type: 'ERC20' | 'ERC721' | 'ERC1155';
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      tokenId?: string;
    }
>;
export type NativeDappControlReview = Readonly<{
  id: string;
  revision: number;
  appName: string;
  origin: string;
  originSource: 'peer-metadata';
  verification: WalletConnectVerification;
  accountLabel: string;
  address: string;
  networkLabel: string;
  chainId: string;
  expiresAt: number;
  busy: boolean;
  error: 'BLOCKED_SITE' | 'SITE_MISMATCH' | 'CONTROL_UNAVAILABLE' | null;
  details: NativeDappControlDetails | null;
}>;
export type NativeDappControlCommit = Readonly<{
  result: null | true;
  assertCurrent(): void;
}>;
/** Retains the existing provider/catalogue/asset admission, including expected switch transitions. */
export type NativePreparedDappControl = Readonly<{
  details: NativeDappControlDetails;
  assertCurrent(): void;
  commit(assertRequestCurrent: () => void): Promise<NativeDappControlCommit>;
  dispose(): void;
}>;
export type NativeDappControlContext = Readonly<{
  revision: number;
  catalogueRevision: number;
  activeAccountId: string;
  networkId: string;
  networkLabel: string;
  accounts: readonly NativeCatalogueAccount[];
}>;
export type NativeDappControlHost = Readonly<{
  /** Ready public custody context across families; never a signing context. */
  context(): NativeDappControlContext | null;
  prepare(
    request: NativeDappControlRequest,
    owner: Readonly<{ accountId: string; networkId: string; address: string }>,
    signal: AbortSignal,
    assertRequestCurrent: () => void
  ): Promise<NativePreparedDappControl>;
}>;
export type NativeDappControlAdmission = Readonly<{
  networkFamily: 'ethereum' | 'syscoin';
  order: number;
  accountId: string;
  networkId: string;
  accountLabel: string;
  address: string;
  networkLabel: string;
  chainId: string;
  assertCurrent(): void;
  /** Exact topic/origin/grant/account/request ownership; the host owns a deliberate network transition. */
  assertSessionCurrent(): void;
}>;
type Pending = {
  id: string;
  wire: WalletConnectRequest;
  request: NativeDappControlRequest;
  owner: NativeDappControlAdmission;
  lifetime: AbortController;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  busy: boolean;
  committing: boolean;
  prepared?: NativePreparedDappControl;
  committed?: NativeDappControlCommit;
  error: NativeDappControlReview['error'];
};
type Options = {
  host(): NativeDappControlHost;
  foreground(order: number): boolean;
  changed(): void;
  checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
  respond(
    wire: WalletConnectRequest,
    response:
      | { result: unknown }
      | { error: { code: number; message: string } },
    check: () => void
  ): Promise<void>;
};
/** Bounded ephemeral requests. UI receives public observations, never mutation capabilities. */
export class NativeDappControlRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly drain = new NativeOperationDrain();
  private closed = false;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  get firstOrder(): number {
    return this.first()?.owner.order ?? Infinity;
  }
  get size(): number {
    return this.pending.size;
  }
  count(topic: string): number {
    return [...this.pending.values()].filter(
      (entry) => entry.wire.session.binding.topic === topic
    ).length;
  }
  private first() {
    return this.pending.values().next().value as Pending | undefined;
  }
  has(wire: WalletConnectRequest): boolean {
    return [...this.pending.values()].some(
      (entry) =>
        entry.wire.id === wire.id &&
        entry.wire.session.binding.topic === wire.session.binding.topic
    );
  }
  private check(entry: Pending) {
    if (
      this.pending.get(entry.id) !== entry ||
      entry.lifetime.signal.aborted ||
      entry.expiresAt <= Date.now()
    )
      throw new Error('REQUEST_EXPIRED');
    if (entry.committing) entry.owner.assertSessionCurrent();
    else entry.owner.assertCurrent();
  }
  enqueue(
    wire: WalletConnectRequest,
    request: NativeDappControlRequest,
    owner: NativeDappControlAdmission
  ) {
    if (this.closed) throw new Error('REQUEST_EXPIRED');
    const id = `control-${owner.order}`;
    const expiresAt = Math.min(
      wire.expiresAt,
      wire.session.expiry * 1000,
      Date.now() + 5 * 60_000
    );
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      throw new Error('REQUEST_EXPIRED');
    const entry: Pending = {
      id,
      wire,
      request,
      owner,
      lifetime: new AbortController(),
      expiresAt,
      timer: setTimeout(() => {
        void this.retire(entry, true);
      }, expiresAt - Date.now()),
      busy: false,
      committing: false,
      error: wire.verification.isScam
        ? 'BLOCKED_SITE'
        : wire.verification.validation === 'INVALID'
        ? 'SITE_MISMATCH'
        : null,
    };
    this.pending.set(id, entry);
    this.options.changed();
    void this.prepare();
  }
  review(revision: number): NativeDappControlReview | null {
    const entry = this.first();
    if (!entry || !this.options.foreground(entry.owner.order)) return null;
    return Object.freeze({
      id: entry.id,
      revision,
      appName: entry.wire.session.metadata.name,
      origin: entry.wire.session.binding.origin,
      originSource: 'peer-metadata',
      verification: entry.wire.verification,
      accountLabel: entry.owner.accountLabel,
      address: entry.owner.address,
      networkLabel: entry.owner.networkLabel,
      chainId: entry.owner.chainId,
      expiresAt: entry.expiresAt,
      busy: entry.busy,
      error: entry.error,
      details: entry.prepared?.details ?? null,
    });
  }
  async prepare() {
    const entry = this.first();
    if (
      this.closed ||
      !entry ||
      entry.busy ||
      entry.prepared ||
      entry.error ||
      !this.options.foreground(entry.owner.order)
    )
      return;
    entry.busy = true;
    const finish = this.drain.begin();
    try {
      this.options.changed();
      this.check(entry);
      const site = await this.options.checkSite(
        entry.wire.session.binding.origin
      );
      this.check(entry);
      if (site.isBlacklisted) {
        entry.error = 'BLOCKED_SITE';
        return;
      }
      const prepared = await this.options.host().prepare(
        entry.request,
        {
          accountId: entry.owner.accountId,
          networkId: entry.owner.networkId,
          address: entry.owner.address,
        },
        entry.lifetime.signal,
        () => this.check(entry)
      );
      try {
        this.check(entry);
        prepared.assertCurrent();
      } catch (cause) {
        prepared.dispose();
        throw cause;
      }
      entry.prepared = prepared;
      if ('kind' in entry.request && !requiresDappModeSwitch(entry.request, entry.owner.networkFamily)) {
        entry.committing = true;
        entry.committed = await prepared.commit(() => this.check(entry));
        this.check(entry); entry.committed.assertCurrent();
        await this.options.respond(entry.wire, { result: entry.committed.result }, () => { this.check(entry); entry.committed!.assertCurrent(); });
        await this.retire(entry, false);
      }
    } catch (cause) {
      if (this.pending.get(entry.id) === entry) {
        if (entry.committing) { await this.retire(entry, false); return; }
        if (cause instanceof EthereumRpcErrorHandler) {
          try {
            this.check(entry);
            await this.options.respond(
              entry.wire,
              {
                error: {
                  code: cause.code,
                  message: cause.message.slice(0, 256),
                },
              },
              () => this.check(entry)
            );
          } catch {
            // A retired request must never receive a replacement-session response.
          } finally {
            await this.retire(entry, false);
          }
        } else entry.error = 'CONTROL_UNAVAILABLE';
      }
    } finally {
      entry.busy = false;
      finish();
      this.options.changed();
    }
  }
  async approve(id: string) {
    const entry = this.first();
    if (
      this.closed ||
      !entry ||
      entry.id !== id ||
      entry.busy ||
      entry.error ||
      !entry.prepared ||
      !this.options.foreground(entry.owner.order)
    )
      throw new Error('REQUEST_EXPIRED');
    entry.busy = true;
    const finish = this.drain.begin();
    try {
      this.options.changed();
      this.check(entry);
      entry.prepared.assertCurrent();
      const site = await this.options.checkSite(
        entry.wire.session.binding.origin
      );
      this.check(entry);
      entry.prepared.assertCurrent();
      if (site.isBlacklisted) throw new Error('BLOCKED_SITE');
      entry.committing = true;
      entry.committed = await entry.prepared.commit(() => this.check(entry));
      this.check(entry);
      entry.committed.assertCurrent();
      await this.options.respond(
        entry.wire,
        { result: entry.committed.result },
        () => {
          this.check(entry);
          entry.committed!.assertCurrent();
        }
      );
      await this.retire(entry, false);
    } catch (cause) {
      await this.retire(entry, !entry.committed);
      throw cause;
    } finally {
      entry.busy = false;
      finish();
      this.options.changed();
    }
  }
  async reject(id: string) {
    const entry = this.pending.get(id);
    if (entry && !entry.committing) await this.retire(entry, true);
  }
  revalidate() {
    for (const entry of this.pending.values()) {
      try {
        this.check(entry);
        if (!entry.committing) entry.prepared?.assertCurrent();
      } catch {
        void this.retire(entry, false);
      }
    }
  }
  expire(id: number) {
    for (const entry of this.pending.values())
      if (entry.wire.id === id) void this.retire(entry, false);
  }
  clear() {
    for (const entry of this.pending.values()) void this.retire(entry, false);
  }
  dispose(): Promise<void> {
    return this.drain.close(() => {
      this.closed = true;
      this.clear();
    }, []);
  }
  private async retire(entry: Pending, respond: boolean) {
    if (this.pending.get(entry.id) !== entry) return;
    this.pending.delete(entry.id);
    clearTimeout(entry.timer);
    entry.lifetime.abort();
    entry.prepared?.dispose();
    this.options.changed();
    if (respond)
      await this.options
        .respond(
          entry.wire,
          {
            error: { code: 4001, message: 'User rejected or request expired' },
          },
          entry.owner.assertSessionCurrent
        )
        .catch(() => undefined);
    void this.prepare();
  }
}
