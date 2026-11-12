import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { NativeConnectionAccount } from './host.ts';
import type { WalletConnectRequest, WalletConnectVerification } from './walletConnect.ts';

export type NativeAccountChangeReview = Readonly<{
  id: string; revision: number; appName: string; origin: string; verification: WalletConnectVerification;
  networkLabel: string; chainId: string; expiresAt: number; busy: boolean;
  accounts: readonly Readonly<{ id: string; label: string; address: string; type: string }>[];
  currentAccountId: string; selectedAccountId: string;
  error: 'BLOCKED_SITE' | 'SITE_MISMATCH' | 'UNAVAILABLE' | null;
}>;
export type AccountChangeOwner = Readonly<{
  order: number; networkLabel: string; chainId: string; currentAccountId: string;
  accounts: readonly NativeConnectionAccount[]; assertCurrent(): void;
}>;
type Pending = { id: string; wire: WalletConnectRequest; owner: AccountChangeOwner; selected: string;
  lifetime: AbortController; timer: ReturnType<typeof setTimeout>; busy: boolean; error: NativeAccountChangeReview['error'] };
/** Public account consent only. The shared session engine owns the permission write. */
export class NativeAccountChangeRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly drain = new NativeOperationDrain();
  private closed = false;
  private readonly options: {
    foreground(order: number): boolean; changed(): void;
    checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
    commit(wire: WalletConnectRequest, account: NativeConnectionAccount, signal: AbortSignal, check: () => void): Promise<void>;
    reject(wire: WalletConnectRequest): Promise<void>;
  };
  constructor(options: NativeAccountChangeRequests['options']) { this.options = options; }
  get firstOrder() { return this.pending.values().next().value?.owner.order ?? Infinity; }
  get size() { return this.pending.size; }
  count(topic: string) { return [...this.pending.values()].filter(entry => entry.wire.session.binding.topic === topic).length; }
  has(wire: WalletConnectRequest) { return [...this.pending.values()].some(entry => entry.wire.id === wire.id && entry.wire.session.binding.topic === wire.session.binding.topic); }
  private check(entry: Pending) {
    if (this.closed || this.pending.get(entry.id) !== entry || entry.lifetime.signal.aborted || entry.wire.expiresAt <= Date.now() || entry.wire.session.expiry * 1000 <= Date.now()) throw Error('REQUEST_EXPIRED');
    entry.owner.assertCurrent();
  }
  enqueue(wire: WalletConnectRequest, owner: AccountChangeOwner) {
    owner.assertCurrent();
    if (this.closed || this.has(wire)) throw Error('REQUEST_EXPIRED');
    const lifetime = new AbortController(), id = `account-${owner.order}`;
    const entry: Pending = { id, wire, owner, lifetime, selected: owner.currentAccountId, busy: false,
      timer: setTimeout(() => this.retire(entry), Math.max(0, Math.min(wire.expiresAt, wire.session.expiry * 1000) - Date.now())),
      error: wire.verification.isScam ? 'BLOCKED_SITE' : wire.verification.validation === 'INVALID' ? 'SITE_MISMATCH' : null };
    this.pending.set(id, entry); this.options.changed();
  }
  review(revision: number): NativeAccountChangeReview | null {
    const entry = this.pending.values().next().value;
    if (!entry || !this.options.foreground(entry.owner.order)) return null;
    return Object.freeze({ id: entry.id, revision, appName: entry.wire.session.metadata.name, origin: entry.wire.session.binding.origin,
      verification: entry.wire.verification, networkLabel: entry.owner.networkLabel, chainId: entry.owner.chainId,
      expiresAt: Math.min(entry.wire.expiresAt, entry.wire.session.expiry * 1000), busy: entry.busy,
      accounts: Object.freeze(entry.owner.accounts.map(({ id, label, address, type }) => Object.freeze({ id, label, address, type }))),
      currentAccountId: entry.owner.currentAccountId, selectedAccountId: entry.selected, error: entry.error });
  }
  select(id: string, accountId: string) {
    const entry = this.pending.get(id);
    if (!entry || entry.busy || !this.options.foreground(entry.owner.order)) throw Error('REQUEST_EXPIRED');
    this.check(entry);
    if (!entry.owner.accounts.some(account => account.id === accountId)) throw Error('CONTEXT_CHANGED');
    entry.selected = accountId; this.options.changed();
  }
  async approve(id: string) {
    const entry = this.pending.get(id);
    if (!entry || entry.busy || entry.error || !this.options.foreground(entry.owner.order)) throw Error('REQUEST_EXPIRED');
    this.check(entry);
    const account = entry.owner.accounts.find(account => account.id === entry.selected);
    if (!account) throw Error('CONTEXT_CHANGED');
    entry.busy = true; this.options.changed(); const finish = this.drain.begin();
    try {
      const site = await this.options.checkSite(entry.wire.session.binding.origin); this.check(entry);
      if (site.isBlacklisted) { entry.error = 'BLOCKED_SITE'; return; }
      await this.options.commit(entry.wire, account, entry.lifetime.signal, () => this.check(entry));
      this.retire(entry);
    } catch (cause) { this.retire(entry); throw cause; }
    finally { entry.busy = false; finish(); this.options.changed(); }
  }
  async reject(id: string) {
    const entry = this.pending.get(id); if (!entry) return;
    const responding = !entry.busy; this.retire(entry);
    if (responding) await this.options.reject(entry.wire).catch(() => undefined);
  }
  private retire(entry: Pending) {
    if (this.pending.get(entry.id) !== entry) return;
    this.pending.delete(entry.id); clearTimeout(entry.timer); entry.lifetime.abort(); this.options.changed();
  }
  revalidate() { for (const entry of this.pending.values()) { try { this.check(entry); } catch { this.retire(entry); } } }
  expire(id: number) { for (const entry of this.pending.values()) if (entry.wire.id === id) this.retire(entry); }
  clear() { for (const entry of this.pending.values()) this.retire(entry); }
  dispose() { return this.drain.close(() => { this.closed = true; this.clear(); }, []); }
}
