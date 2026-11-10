import type { SentryApproval, SentryVoteApproval } from '../../../../source/wallet/sentryApprovalTypes.ts';
import type { SentryNodeLinkReview } from '../../../../source/wallet/sentryNodeManagement.ts';
import type { SentryRequiredAuthorization } from '@sidhujag/sysweb3-sentry';
import type { WalletConnectRequest, WalletConnectVerification } from './walletConnect.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';

export const SENTRY_DAPP_METHODS = Object.freeze(['sys_signSentryOperation', 'sys_linkSentryNode', 'sys_signSentryVote'] as const);
export type NativeSentryRequest = Readonly<{ method: typeof SENTRY_DAPP_METHODS[number]; raw: unknown; origin: string }>;
export type NativeSentryDetails = Readonly<
  | { kind: 'link'; approval: SentryNodeLinkReview }
  | { kind: 'operation'; approval: SentryApproval }
  | { kind: 'vote'; approval: SentryVoteApproval }
>;
export type NativeSentryAssent = Readonly<
  | { kind: 'link' }
  | { kind: 'operation'; keyId: string; authorizationId?: SentryRequiredAuthorization['id'] }
  | { kind: 'vote' }
>;
export type NativeSentryReview = Readonly<{
  id: string; revision: number; appName: string; origin: string; verification: WalletConnectVerification;
  accountLabel: string; address: string; networkLabel: string; chainId: string; expiresAt: number;
  busy: boolean; error: 'BLOCKED_SITE' | 'SITE_MISMATCH' | 'SENTRY_UNAVAILABLE' | 'DELIVERY_UNCERTAIN' | null;
  details: NativeSentryDetails | null;
}>;
export type NativePreparedSentryRequest = Readonly<{
  details: NativeSentryDetails;
  assertCurrent(): void;
  approve(assent: NativeSentryAssent, assertCurrent: () => void): Promise<unknown>;
  disclose(): void;
  dispose(): void;
}>;
export type NativeConnectionSentryHost = Readonly<{
  prepare(request: NativeSentryRequest, signal: AbortSignal, assertCurrent: () => void, assertGrantCurrent: () => void): Promise<NativePreparedSentryRequest>;
  revalidate(): void;
}>;
type Owner = Readonly<{ order: number; accountLabel: string; address: string; networkLabel: string; chainId: string; assertCurrent(): void; assertGrantCurrent(): void }>;
type Pending = { id: string; wire: WalletConnectRequest; owner: Owner; signal: AbortController; expiresAt: number;
  timer: ReturnType<typeof setTimeout>; busy: boolean; handedOff: boolean; prepared?: NativePreparedSentryRequest; error: NativeSentryReview['error'] };

/** Ephemeral consent joins the existing shared Sentry managers; it holds no keys or durable grants. */
export class NativeSentryRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly drain = new NativeOperationDrain();
  private closed = false;
  private serial = 0;
  private retainedHost: NativeConnectionSentryHost | undefined;
  private readonly options: Readonly<{
    host(): NativeConnectionSentryHost; foreground(order: number): boolean; changed(): void;
    checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
    respond(wire: WalletConnectRequest, response: { result: unknown } | { error: { code: number; message: string } }, check: () => void, handedOff: () => void): Promise<void>;
  }>;
  constructor(options: NativeSentryRequests['options']) { this.options = options; }
  get size() { return this.pending.size; }
  get firstOrder() { return this.first()?.owner.order ?? Infinity; }
  private first() { return this.pending.values().next().value as Pending | undefined; }
  count(topic: string) { return [...this.pending.values()].filter(value => value.wire.session.binding.topic === topic).length; }
  has(wire: WalletConnectRequest) { return [...this.pending.values()].some(value => value.wire.id === wire.id && value.wire.session.binding.topic === wire.session.binding.topic); }
  private check(entry: Pending) {
    if (this.closed || this.pending.get(entry.id) !== entry || entry.signal.signal.aborted || entry.expiresAt <= Date.now()) throw new Error('REQUEST_EXPIRED');
    entry.owner.assertCurrent();
  }
  enqueue(wire: WalletConnectRequest, owner: Owner) {
    if (this.closed) throw new Error('REQUEST_EXPIRED');
    const expiresAt = Math.min(wire.expiresAt, wire.session.expiry * 1000, Date.now() + 10 * 60_000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('REQUEST_EXPIRED');
    const id = `sentry-${++this.serial}`;
    const entry: Pending = { id, wire, owner, signal: new AbortController(), expiresAt, busy: false, handedOff: false,
      timer: setTimeout(() => { this.retire(entry, true); }, expiresAt - Date.now()),
      error: wire.verification.isScam ? 'BLOCKED_SITE' : wire.verification.validation === 'INVALID' ? 'SITE_MISMATCH' : null };
    this.pending.set(id, entry); this.options.changed(); void this.prepare();
  }
  review(revision: number): NativeSentryReview | null {
    const entry = this.first(); if (!entry || !this.options.foreground(entry.owner.order)) return null;
    return Object.freeze({ id: entry.id, revision, appName: entry.wire.session.metadata.name, origin: entry.wire.session.binding.origin,
      verification: entry.wire.verification, accountLabel: entry.owner.accountLabel, address: entry.owner.address,
      networkLabel: entry.owner.networkLabel, chainId: entry.owner.chainId, expiresAt: entry.expiresAt, busy: entry.busy,
      error: entry.error, details: entry.prepared?.details ?? null });
  }
  async prepare() {
    const entry = this.first();
    if (!entry || entry.busy || entry.prepared || entry.error || !this.options.foreground(entry.owner.order)) return;
    entry.busy = true; const finish = this.drain.begin(); this.options.changed();
    try {
      this.check(entry); const site = await this.options.checkSite(entry.wire.session.binding.origin); this.check(entry);
      if (site.isBlacklisted) throw new Error('BLOCKED_SITE');
      const host = this.options.host(); this.retainedHost = host;
      const prepared = await host.prepare({ method: entry.wire.method as NativeSentryRequest['method'], raw: JSON.parse(JSON.stringify((entry.wire.params as unknown[])[0])), origin: entry.wire.session.binding.origin }, entry.signal.signal, () => this.check(entry), entry.owner.assertGrantCurrent);
      try { this.check(entry); if (typeof prepared.disclose !== 'function') throw new Error('SENTRY_UNAVAILABLE'); prepared.assertCurrent(); entry.prepared = prepared; } catch (cause) { prepared.dispose(); throw cause; }
    } catch (cause) {
      if (this.pending.get(entry.id) === entry) {
        try { this.check(entry); } catch { this.retire(entry, false); return; }
        entry.error = cause instanceof Error && cause.message === 'BLOCKED_SITE' ? 'BLOCKED_SITE' : 'SENTRY_UNAVAILABLE';
      }
    } finally { entry.busy = false; finish(); this.options.changed(); }
  }
  async approve(id: string, assent: NativeSentryAssent) {
    const entry = this.first();
    if (!entry || entry.id !== id || entry.busy || entry.error || !entry.prepared || !this.options.foreground(entry.owner.order)) throw new Error('REQUEST_EXPIRED');
    if (assent.kind !== entry.prepared.details.kind) throw new Error('INVALID_INPUT');
    entry.busy = true; const finish = this.drain.begin(); this.options.changed();
    try {
      this.check(entry); entry.prepared.assertCurrent();
      const site = await this.options.checkSite(entry.wire.session.binding.origin); this.check(entry);
      if (site.isBlacklisted) throw new Error('BLOCKED_SITE');
      const result = await entry.prepared.approve(assent, () => this.check(entry)); this.check(entry);
      await this.options.respond(entry.wire, { result }, () => this.check(entry), () => { this.check(entry); entry.prepared!.disclose(); entry.handedOff = true; });
      this.retire(entry, false);
    } catch (cause) {
      if (this.pending.get(entry.id) === entry) {
        try { this.check(entry); } catch { this.retire(entry, false); throw cause; }
        entry.error = entry.handedOff ? 'DELIVERY_UNCERTAIN' : cause instanceof Error && cause.message === 'BLOCKED_SITE' ? 'BLOCKED_SITE' : 'SENTRY_UNAVAILABLE';
      }
      throw cause;
    } finally { entry.busy = false; finish(); this.options.changed(); }
  }
  reject(id: string) { const entry = this.pending.get(id); if (entry) this.retire(entry, !entry.handedOff); }
  expire(id: number) { for (const entry of [...this.pending.values()]) if (entry.wire.id === id) this.retire(entry, false); }
  revalidate() { this.retainedHost?.revalidate(); for (const entry of [...this.pending.values()]) { try { this.check(entry); } catch { this.retire(entry, false); } } }
  private retire(entry: Pending, respond: boolean) {
    if (this.pending.get(entry.id) !== entry) return;
    this.pending.delete(entry.id); clearTimeout(entry.timer); entry.signal.abort(); entry.prepared?.dispose(); this.options.changed();
    if (respond && !this.closed) {
      const finish = this.drain.begin();
      void this.options.respond(entry.wire, { error: { code: 4001, message: 'User rejected' } }, entry.owner.assertCurrent, () => {}).catch(() => {}).finally(finish);
    }
    void this.prepare();
  }
  clear() { for (const entry of [...this.pending.values()]) this.retire(entry, false); }
  dispose() { return this.drain.close(() => { this.closed = true; this.clear(); }, []); }
}
