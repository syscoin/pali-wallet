import { capturePsbtEnvelope, type PsbtEnvelope } from '../../../../source/shared/psbtEnvelope.ts';
import type { PsbtApprovalMethod, PsbtApprovalReview, PreparedPsbtApproval } from '../../../../source/wallet/psbtApprovals.ts';
import { assertProviderRequestBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { NativeSigningHandoffs, sameSigningResumeOwner, type NativeSigningHandoff, type SigningResumeScope, type SigningHandoffDescriptor } from './signingHandoff.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { WalletConnectRequest, WalletConnectVerification } from './walletConnect.ts';

export const PSBT_DAPP_METHODS = Object.freeze(['sys_sign', 'sys_signAndSend'] as const);
export type NativePsbtRequest = Readonly<{ method: PsbtApprovalMethod; psbt: PsbtEnvelope; origin: string }>;
export type NativeConnectionPsbtHost = Readonly<{
  cancelHandoff(job: object): Promise<void>;
  prepare(request: NativePsbtRequest, signal: AbortSignal, assertCurrent: () => void, handoff: NativeSigningHandoff): Promise<PreparedPsbtApproval>;
}>;
export type NativePsbtReview = Readonly<{
  id: string; revision: number; method: PsbtApprovalMethod; appName: string; origin: string; verification: WalletConnectVerification;
  accountLabel: string; address: string; networkLabel: string; chainId: string; symbol: string; decimals: number; expiresAt: number;
  busy: boolean; attempted: boolean; txid: string | null;
  error: 'BLOCKED_SITE' | 'SITE_MISMATCH' | 'PSBT_UNAVAILABLE' | 'SUBMISSION_UNCERTAIN' | 'DELIVERY_UNCERTAIN' | null;
  details: PsbtApprovalReview | null;
}>;
type Owner = Readonly<{ order: number; accountLabel: string; address: string; networkLabel: string; chainId: string;
  symbol: string; decimals: number; resumeScope: SigningResumeScope; assertCurrent(): void; assertSessionCurrent(): void }>;
type Pending = { id: string; wire: WalletConnectRequest; request: NativePsbtRequest; owner: Owner; signal: AbortController;
  expiresAt: number; timer: ReturnType<typeof setTimeout>; busy: boolean; attempted: boolean; handedOff: boolean; resultReady: boolean;
  resumeId: string; handoff?: NativeSigningHandoff;
  txid: string | null; prepared?: PreparedPsbtApproval; work?: ReturnType<PreparedPsbtApproval['approve']>; error: NativePsbtReview['error'] };

/** Request-owned consent only. Verification, signing and durable submission stay in the common engine. */
export class NativePsbtRequests {
  private readonly pending = new Map<string, Pending>();
  private readonly drain = new NativeOperationDrain();
  private closed = false;
  private serial = 0;
  private readonly handoffs: NativeSigningHandoffs;
  discardHandoff(descriptor: SigningHandoffDescriptor) { this.handoffs.discard(descriptor); }
  descriptor(id: string) { return this.handoffs.descriptor(id); }
  cancelHandoff() { return this.handoffs.cancelDapp(); }
  drainSuspended(id: string) { return this.handoffs.drain(id); }
  revalidateSuspended(check: (descriptor: SigningHandoffDescriptor) => boolean) { this.handoffs.revalidate(check); }
  private eligible(entry: Pending) {
    return entry.busy && entry.attempted && !entry.resultReady && !entry.handedOff &&
      !!entry.prepared && entry.prepared.disposition().transactionNotBroadcast;
  }
  background() {
    const entry = this.first();
    if (entry && (!entry.handoff || !this.handoffs.background(entry.handoff))) this.reject(entry.id);
  }
  private handoff(entry: Pending): NativeSigningHandoff {
    return entry.handoff ??= this.handoffs.capture({ id: entry.resumeId, wire: entry.wire, scope: entry.owner.resumeScope,
      expiresAt: entry.expiresAt, order: entry.owner.order, assertCurrent: () => this.check(entry), eligible: () => this.eligible(entry),
      drain: () => entry.work ?? Promise.resolve(), retire: () => this.retire(entry, false),
    });
  }
  private readonly options: Readonly<{
    host(): NativeConnectionPsbtHost; foreground(order: number): boolean; changed(): void;
    checkSite(origin: string): Promise<Readonly<{ isBlacklisted: boolean }>>;
    respond(wire: WalletConnectRequest, response: { result: unknown } | { error: { code: number; message: string } }, check: () => void, handedOff: () => void): Promise<void>;
  }>;
  constructor(options: NativePsbtRequests['options']) {
    if (['host', 'foreground', 'changed', 'checkSite', 'respond'].some(key => typeof options[key as keyof typeof options] !== 'function'))
      throw new Error('PSBT_REQUEST_PORTS_REQUIRED');
    this.options = options;
    this.handoffs = new NativeSigningHandoffs({ cancel: job => this.options.host().cancelHandoff(job), changed: () => { this.options.changed(); void this.prepare(); } });
  }
  get size() { return this.pending.size + this.handoffs.size; }
  get firstOrder() { return Math.min(this.first()?.owner.order ?? Infinity, this.handoffs.firstOrder); }
  private first() { return this.pending.values().next().value as Pending | undefined; }
  count(topic: string) { return [...this.pending.values()].filter(value => value.wire.session.binding.topic === topic).length + this.handoffs.count(topic); }
  has(wire: WalletConnectRequest) { return this.handoffs.has(wire) || [...this.pending.values()].some(value => value.wire.id === wire.id && value.wire.session.binding.topic === wire.session.binding.topic); }
  private check(entry: Pending) {
    if (this.closed || this.pending.get(entry.id) !== entry || entry.signal.signal.aborted || entry.expiresAt <= Date.now()) throw new Error('REQUEST_EXPIRED');
    entry.owner.assertCurrent();
  }
  enqueue(wire: WalletConnectRequest, owner: Owner, resumeId?: string) {
    const saved = resumeId === undefined ? null : this.descriptor(resumeId);
    if (resumeId !== undefined && (!saved || saved.wire !== JSON.stringify(wire) || !sameSigningResumeOwner(saved.scope, owner.resumeScope) || owner.resumeScope.unlockGeneration <= saved.scope.unlockGeneration)) throw Error('REQUEST_EXPIRED');
    if (this.closed || !(PSBT_DAPP_METHODS as readonly string[]).includes(wire.method)) throw new Error('REQUEST_EXPIRED');
    assertProviderRequestBudget({ method: wire.method, params: wire.params });
    if (!Array.isArray(wire.params) || wire.params.length !== 1) throw new Error('INVALID_PSBT');
    const raw = wire.params[0];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Reflect.ownKeys(raw).sort().join(',') !== 'assets,psbt')
      throw new Error('INVALID_PSBT');
    const psbt = capturePsbtEnvelope(wire.params[0]);
    const expiresAt = Math.min(wire.expiresAt, wire.session.expiry * 1000, Date.now() + 10 * 60_000, saved?.expiresAt ?? Infinity);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('REQUEST_EXPIRED');
    const id = `psbt-${++this.serial}`;
    const entry: Pending = { id, resumeId: resumeId ?? id, wire, owner: saved ? { ...owner, order: saved.order } : owner, signal: new AbortController(), expiresAt, busy: false, attempted: false, handedOff: false, resultReady: false, txid: null,
      request: Object.freeze({ method: wire.method as PsbtApprovalMethod, psbt, origin: wire.session.binding.origin }),
      timer: setTimeout(() => this.retire(entry, !entry.handedOff), expiresAt - Date.now()),
      error: wire.verification.isScam ? 'BLOCKED_SITE' : wire.verification.validation === 'INVALID' ? 'SITE_MISMATCH' : null };
    if (saved) {
      const waiting = [...this.pending]; this.pending.clear(); this.pending.set(id, entry);
      for (const [key, value] of waiting) this.pending.set(key, value);
      this.handoffs.discard(saved, false);
    } else this.pending.set(id, entry);
    this.options.changed(); void this.prepare();
  }
  review(revision: number): NativePsbtReview | null {
    const entry = this.first(); if (this.handoffs.active || !entry || !this.options.foreground(entry.owner.order)) return null;
    return Object.freeze({ id: entry.id, revision, method: entry.request.method, appName: entry.wire.session.metadata.name,
      origin: entry.request.origin, verification: entry.wire.verification, accountLabel: entry.owner.accountLabel, address: entry.owner.address,
      networkLabel: entry.owner.networkLabel, chainId: entry.owner.chainId, symbol: entry.owner.symbol, decimals: entry.owner.decimals,
      expiresAt: entry.expiresAt, busy: entry.busy, attempted: entry.attempted, txid: entry.txid,
      error: entry.error, details: entry.prepared?.review ?? null });
  }
  async prepare() {
    const entry = this.first();
    if (this.closed || !entry || this.handoffs.active || entry.busy || entry.prepared || entry.error || !this.options.foreground(entry.owner.order)) return;
    entry.busy = true; const finish = this.drain.begin(); this.options.changed();
    try {
      await this.handoffs.retired();
      this.check(entry); const site = await this.options.checkSite(entry.request.origin); this.check(entry);
      if (site.isBlacklisted) throw new Error('BLOCKED_SITE');
      const prepared = await this.options.host().prepare(entry.request, entry.signal.signal, () => this.check(entry), this.handoff(entry));
      try {
        this.check(entry); prepared.assertCurrent();
        if (typeof prepared.disposition !== 'function') throw new Error('PSBT_REQUEST_PORTS_REQUIRED');
        if (prepared.review.origin !== entry.request.origin || prepared.review.method !== entry.request.method) throw new Error('CONTEXT_CHANGED');
        entry.prepared = prepared;
      } catch (cause) { prepared.dispose(); throw cause; }
    } catch (cause) {
      if (this.pending.get(entry.id) === entry) {
        try { this.check(entry); } catch { this.retire(entry, false); return; }
        entry.error = cause instanceof Error && cause.message === 'BLOCKED_SITE' ? 'BLOCKED_SITE' : 'PSBT_UNAVAILABLE';
      }
    } finally { entry.busy = false; finish(); this.options.changed(); }
  }
  async approve(id: string) {
    const entry = this.first();
    if (!entry || this.handoffs.active || entry.id !== id || entry.busy || entry.attempted || entry.error || !entry.prepared || !this.options.foreground(entry.owner.order)) throw new Error('REQUEST_EXPIRED');
    entry.busy = true; const finish = this.drain.begin(); this.options.changed();
    try {
      this.check(entry); entry.prepared.assertCurrent();
      const site = await this.options.checkSite(entry.request.origin); this.check(entry);
      if (site.isBlacklisted) throw new Error('BLOCKED_SITE');
      entry.attempted = true;
      entry.work = entry.prepared.approve();
      const result = await entry.work; this.check(entry);
      entry.resultReady = true;
      if ('txid' in result) entry.txid = result.txid;
      await this.options.respond(entry.wire, { result }, () => this.check(entry), () => { entry.handedOff = true; });
      this.retire(entry, false);
    } catch (cause) {
      if (this.pending.get(entry.id) === entry) {
        try { this.check(entry); } catch { this.retire(entry, false); throw cause; }
        const disposition = entry.prepared.disposition();
        if (!disposition.transactionNotBroadcast) entry.txid = disposition.txid;
        entry.error = entry.resultReady || entry.handedOff ? 'DELIVERY_UNCERTAIN' : !disposition.transactionNotBroadcast
          ? 'SUBMISSION_UNCERTAIN' : cause instanceof Error && cause.message === 'BLOCKED_SITE' ? 'BLOCKED_SITE' : 'PSBT_UNAVAILABLE';
      }
      throw cause;
    } finally { entry.busy = false; finish(); this.options.changed(); }
  }
  reject(id: string) { const entry = this.pending.get(id); if (entry) this.retire(entry, !entry.handedOff); }
  expire(id: number) { this.handoffs.expire(id); for (const entry of [...this.pending.values()]) if (entry.wire.id === id) this.retire(entry, false); }
  revalidate() { for (const entry of [...this.pending.values()]) { try { this.check(entry); } catch { this.retire(entry, true); } } }
  private retire(entry: Pending, respond: boolean) {
    if (this.pending.get(entry.id) !== entry) return;
    this.pending.delete(entry.id); clearTimeout(entry.timer); entry.signal.abort(); entry.prepared?.dispose(); this.options.changed();
    if (respond && !this.closed) {
      const finish = this.drain.begin();
      void (async () => {
        await entry.work?.catch(() => undefined);
        if (this.closed || entry.handedOff || entry.prepared && !entry.prepared.disposition().transactionNotBroadcast) return;
        await this.options.respond(entry.wire, { error: { code: 4001, message: 'User rejected' } }, entry.owner.assertSessionCurrent, () => {});
      })().catch(() => {}).finally(finish);
    }
    void this.prepare();
  }
  clear() { this.handoffs.cancelDapp(); for (const entry of [...this.pending.values()]) this.retire(entry, false); }
  dispose() { return this.drain.close(() => { this.closed = true; this.clear(); }, [() => this.handoffs.retired()]); }
}
