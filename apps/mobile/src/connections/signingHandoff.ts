import { measureJsonWorkBudget, DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import type { NativeSmartLocalAction } from '../custody/trezorAccounts.ts';
import type { NativeConnectionBinding } from './storage.ts';
import type { WalletConnectRequest } from './walletConnect.ts';

/** Public request correlation only; no old approval, keyring or signing context survives lock. */
export type NativeSigningHandoff = Readonly<{
  id: string;
  expiresAt: number;
  beforeSuiteOpen(expiresAt: number, job: object): (opened: boolean) => void;
  beforeSignature(): void;
  isSuspended(): boolean;
}>;
/** Required native caller contract; an omitted continuation cannot renew approval. */
export function requireNativeSigningHandoff(value: unknown): asserts value is NativeSigningHandoff {
  const handoff = value as Partial<NativeSigningHandoff> | null;
  if (!handoff || typeof handoff.id !== 'string' || !handoff.id || !Number.isSafeInteger(handoff.expiresAt) ||
      Number(handoff.expiresAt) <= Date.now() || typeof handoff.beforeSuiteOpen !== 'function' ||
      typeof handoff.beforeSignature !== 'function' || typeof handoff.isSuspended !== 'function')
    throw new Error('Native signing continuation authority is required');
}
export type SigningResumeScope = Readonly<{ adapter: number; wallet: string; unlockGeneration: number; accountId: string; address: string; type: string; xpub: string; registration: string; grant: string; signing: string; trezor: boolean }>;
export type LocalSigningResumeScope = Omit<SigningResumeScope, 'adapter' | 'grant'>;
export const sameSigningResumeOwner = (a: SigningResumeScope | LocalSigningResumeScope, b: SigningResumeScope | LocalSigningResumeScope) => {
  const { unlockGeneration: _a, ...left } = a, { unlockGeneration: _b, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
};
export type SigningHandoffDescriptor = Readonly<{
  kind: 'dapp'; id: string; binding: NativeConnectionBinding; requestId: number; wire: string;
  scope: SigningResumeScope; expiresAt: number; order: number; job: object;
}>;
export type LocalSigningHandoffDescriptor = Readonly<{
  kind: 'local-smart'; id: string; action: NativeSmartLocalAction; scope: LocalSigningResumeScope;
  expiresAt: number; order: number; job: object;
}>;
type Descriptor = SigningHandoffDescriptor | LocalSigningHandoffDescriptor;
type Capture = Readonly<{
  id: string; scope: SigningResumeScope | LocalSigningResumeScope; expiresAt: number; order: number;
  assertCurrent(): void; eligible(): boolean; drain(): Promise<unknown>; retire(): void;
}>;
type Entry = Capture & Readonly<{wire: WalletConnectRequest; scope: SigningResumeScope}>;
type LocalEntry = Capture & Readonly<{action: NativeSmartLocalAction; scope: LocalSigningResumeScope}>;
type PrivateContinuation = { retire(): void };
type ContinuationOwner = {
  phase: 'active' | 'suspended' | 'retired';
  acquiring: boolean;
  expiresAt: number;
  assertCurrent(): void;
  completeOwnerStep(final: boolean): void;
  retireJob(): void;
  job?: object;
  continuation?: PrivateContinuation;
};
// Renderer-visible descriptors never carry signature outputs or custody state.
const continuationOwners = new WeakMap<NativeSigningHandoff, ContinuationOwner>();
export function captureNativeSigningContinuation<T extends PrivateContinuation>(handoff: NativeSigningHandoff, create: (expiresAt: number) => T): T {
  const owner = continuationOwners.get(handoff);
  if (!owner || owner.phase !== 'active') throw Error('REQUEST_EXPIRED');
  if (owner.acquiring) { retireNativeSigningHandoff(handoff); throw Error('REQUEST_EXPIRED'); }
  owner.acquiring = true;
  const check = () => {
    owner.assertCurrent();
    if (continuationOwners.get(handoff) !== owner || owner.phase !== 'active' || Date.now() >= owner.expiresAt)
      throw Error('REQUEST_EXPIRED');
  };
  try {
    check();
    if (!owner.continuation) {
      const created = create(owner.expiresAt);
      if (!created || typeof created.retire !== 'function') throw Error('Invalid signing continuation');
      try { check(); } catch (error) { created?.retire(); throw error; }
      owner.continuation = created;
    }
    if (!owner.continuation || typeof owner.continuation.retire !== 'function') throw Error('Invalid signing continuation');
    check();
    return owner.continuation as T;
  } catch (error) { retireNativeSigningHandoff(handoff); throw error; }
  finally { owner.acquiring = false; }
}
export function retireNativeSigningHandoff(handoff: NativeSigningHandoff): void {
  const owner = continuationOwners.get(handoff);
  if (!owner) return;
  const active = owner.phase === 'active';
  owner.phase = 'retired';
  continuationOwners.delete(handoff);
  const continuation = owner.continuation;
  owner.continuation = undefined;
  try { continuation?.retire(); } finally { if (active) owner.retireJob(); owner.job = undefined; }
}
export function completeNativeSigningOwnerStep(handoff: NativeSigningHandoff, final: boolean): void {
  const owner = continuationOwners.get(handoff);
  if (!owner || owner.phase !== 'active') throw Error('REQUEST_EXPIRED');
  try {
    if (typeof final !== 'boolean' || Date.now() >= owner.expiresAt) throw Error('REQUEST_EXPIRED');
    owner.completeOwnerStep(final);
    if (continuationOwners.get(handoff) !== owner || owner.phase !== 'active' || Date.now() >= owner.expiresAt) throw Error('REQUEST_EXPIRED');
  } catch (error) { retireNativeSigningHandoff(handoff); throw error; }
}
type Suspended = { descriptor: Descriptor; token: object; timer: ReturnType<typeof setTimeout>; draining: Promise<unknown>; claimed: boolean; continuation?: PrivateContinuation };
function freezePublicJson<T>(value: T): T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freezePublicJson(child);Object.freeze(value);}
  return value;
}
/** One bounded Suite departure policy shared by structured PSBT and EVM/message requests. */
export class NativeSigningHandoffs {
  private suspended: Suspended | undefined;
  private retirement: Promise<void> = Promise.resolve();
  private readonly controls = new WeakMap<NativeSigningHandoff, { background(): boolean; bindPreparedScope?(scope: SigningResumeScope): void }>();
  private readonly options: Readonly<{ cancel(job: object): Promise<void>; changed(): void }>;
  constructor(options: NativeSigningHandoffs['options']) { this.options = options; }
  get active() { return this.suspended !== undefined; }
  get firstOrder() { return this.suspended?.descriptor.order ?? Infinity; }
  get size() { return this.suspended ? 1 : 0; }
  count(topic: string) { const value=this.suspended?.descriptor; return value?.kind === 'dapp' && value.binding.topic === topic ? 1 : 0; }
  has(wire: WalletConnectRequest) { const value=this.suspended?.descriptor; return value?.kind === 'dapp' && value.requestId === wire.id && value.binding.topic === wire.session.binding.topic; }
  private cancelJob(job: object) {
    this.retirement = this.retirement.then(() => this.options.cancel(job));
    void this.retirement.catch(() => undefined);
  }
  discard(descriptor = this.suspended?.descriptor, cancel = true) {
    const saved = this.suspended;
    if (!saved || saved.descriptor !== descriptor) return;
    clearTimeout(saved.timer); this.suspended = undefined;
    const continuation = saved.continuation; saved.continuation = undefined; continuation?.retire();
    if (cancel) this.cancelJob(saved.descriptor.job);
    this.options.changed();
  }
  private currentDescriptor(id: string) {
    const saved = this.suspended;
    if (saved && saved.descriptor.expiresAt <= Date.now()) { this.discard(saved.descriptor); return null; }
    return saved?.descriptor.id === id ? saved.descriptor : null;
  }
  descriptor(id: string) { const value=this.currentDescriptor(id); return value?.kind === 'dapp' ? value : null; }
  localDescriptor(id: string) { const value=this.currentDescriptor(id); return value?.kind === 'local-smart' ? value : null; }
  cancelDapp() { const value=this.suspended?.descriptor; if(value?.kind !== 'dapp')return;this.discard(value);return value; }
  cancelLocal() { const value=this.suspended?.descriptor;if(value?.kind !== 'local-smart')return;this.discard(value);return value; }
  async drain(id: string) {
    const saved = this.suspended;
    if (!saved || !this.currentDescriptor(id)) throw Error('REQUEST_EXPIRED');
    await saved.draining;
    if (this.suspended !== saved || !this.currentDescriptor(id)) throw Error('REQUEST_EXPIRED');
  }
  revalidate(check: (descriptor: SigningHandoffDescriptor) => boolean) { const value=this.suspended?.descriptor;if(value?.kind === 'dapp' && !check(value))this.discard(value); }
  revalidateLocal(check: (descriptor: LocalSigningHandoffDescriptor) => boolean) { const value=this.suspended?.descriptor;if(value?.kind === 'local-smart' && !check(value))this.discard(value); }
  expire(id: number) { const value=this.suspended?.descriptor;if(value?.kind === 'dapp' && value.requestId === id)this.discard(value); }
  retired() { return this.retirement; }
  capture(entry: Entry): NativeSigningHandoff {
    return this.captureDapp(entry, null);
  }
  resume(entry: Entry, descriptor: SigningHandoffDescriptor): NativeSigningHandoff {
    if (this.suspended?.descriptor === descriptor && this.suspended.claimed) throw Error('REQUEST_EXPIRED');
    if (descriptor.wire !== JSON.stringify(entry.wire)) { this.discard(descriptor); throw Error('REQUEST_EXPIRED'); }
    return this.captureDapp(entry, descriptor);
  }
  private captureDapp(entry: Entry, resume: SigningHandoffDescriptor | null): NativeSigningHandoff {
    const fresh = entry.wire.freshness === 'fresh';
    if (entry.scope.trezor && !fresh) throw Error('REQUEST_EXPIRED');
    const wire=JSON.stringify(entry.wire),requestId=entry.wire.id,binding=Object.freeze({...entry.wire.session.binding});
    return this.captureState(entry,fresh,(job,expiresAt,scope)=>Object.freeze({kind:'dapp',id:entry.id,binding,requestId,wire,scope:scope as SigningResumeScope,expiresAt,order:entry.order,job}),true,resume);
  }
  captureLocal(entry: LocalEntry, snapshotAction: (action: NativeSmartLocalAction) => NativeSmartLocalAction): NativeSigningHandoff {
    return this.captureLocalState(entry, snapshotAction, null);
  }
  resumeLocal(entry: LocalEntry, snapshotAction: (action: NativeSmartLocalAction) => NativeSmartLocalAction, descriptor: LocalSigningHandoffDescriptor): NativeSigningHandoff {
    if (this.suspended?.descriptor === descriptor && this.suspended.claimed) throw Error('REQUEST_EXPIRED');
    return this.captureLocalState(entry, snapshotAction, descriptor);
  }
  private captureLocalState(entry: LocalEntry, snapshotAction: (action: NativeSmartLocalAction) => NativeSmartLocalAction, resume: LocalSigningHandoffDescriptor | null): NativeSigningHandoff {
    // Locally initiated public actions have a distinct admission source; they
    // never acquire WalletConnect freshness, topic or grant by fabrication.
    // The required local DTO capture keeps asset/signing dependencies out of PSBT transport.
    entry.assertCurrent(); measureJsonWorkBudget(entry.action,DAPP_REQUEST_LIMITS.bytes);
    const action = freezePublicJson(snapshotAction(entry.action));
    if (resume && JSON.stringify(resume.action) !== JSON.stringify(action)) { this.discard(resume); throw Error('REQUEST_EXPIRED'); }
    return this.captureState(entry,true,(job,expiresAt,scope)=>Object.freeze({kind:'local-smart',id:entry.id,action,scope,expiresAt,order:entry.order,job}),false,resume);
  }
  /** Bind canonical preparation once, before the queue exposes its new review. */
  bindPreparedScope(handoff: NativeSigningHandoff, scope: SigningResumeScope): void {
    const bind = this.controls.get(handoff)?.bindPreparedScope;
    if (!bind) throw Error('REQUEST_EXPIRED');
    bind(scope);
  }
  private captureState(entry: Capture, admitted: boolean, describe: (job: object, expiresAt: number, scope: SigningResumeScope | LocalSigningResumeScope) => Descriptor, allowPreparedBinding: boolean, resume: Descriptor | null): NativeSigningHandoff {
    let scope=Object.freeze({...entry.scope});
    const previous = this.suspended;
    if (resume ? !previous || previous.descriptor !== resume || resume.id !== entry.id || resume.order !== entry.order ||
        resume.expiresAt <= Date.now() || entry.expiresAt > resume.expiresAt ||
        previous.claimed || !sameSigningResumeOwner(resume.scope, scope) || scope.unlockGeneration <= resume.scope.unlockGeneration
      : previous?.descriptor.id === entry.id) {
      if (resume) this.discard(resume);
      throw Error('REQUEST_EXPIRED');
    }
    const continuationOwner: ContinuationOwner = { phase: 'active', acquiring: false, expiresAt: entry.expiresAt, assertCurrent: entry.assertCurrent,
      completeOwnerStep(final) { entry.assertCurrent(); if (!eligible()) throw Error('REQUEST_EXPIRED'); marker = undefined; if (final) signatureReady = true; },
      job: resume?.job, retireJob: () => { const job = continuationOwner.job; if (job) this.cancelJob(job); },
      continuation: resume ? previous?.continuation : undefined };
    if (resume && previous) { previous.claimed = true; previous.continuation = undefined; }
    let marker: { token: object; expiresAt: number; launchExpiresAt: number; job: object; scope: typeof scope } | undefined;
    let suspendedToken: object | undefined, signatureReady = false, launched = false, preparedBound = false;
    const eligible = () => {
      if (continuationOwner.phase !== 'active' || signatureReady) return false;
      const result = entry.eligible();
      return result === true && continuationOwner.phase === 'active' && !signatureReady && continuationOwners.get(handoff) === continuationOwner;
    };
    const handoff: NativeSigningHandoff = Object.freeze({ id: entry.id, expiresAt: entry.expiresAt,
      beforeSuiteOpen: (expiresAt, job) => {
        entry.assertCurrent();
        if (!scope.trezor || !admitted || !eligible() || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !job || typeof job !== 'object') throw Error('REQUEST_EXPIRED');
        const launch = { token: {}, job, scope, expiresAt: Math.min(expiresAt, entry.expiresAt), launchExpiresAt: Math.min(Date.now() + 5000, expiresAt, entry.expiresAt) };
        launched = true;
        continuationOwner.job = job;
        marker = launch;
        return opened => {
          if (opened) return;
          if (marker === launch) marker = undefined;
          if (this.suspended?.token === launch.token) this.discard();
        };
      },
      beforeSignature: () => { entry.assertCurrent(); if (!eligible()) throw Error('REQUEST_EXPIRED'); signatureReady = true; marker = undefined; },
      isSuspended: () => !!suspendedToken && this.suspended?.token === suspendedToken,
    });
    continuationOwners.set(handoff, continuationOwner);
    this.controls.set(handoff, { ...(allowPreparedBinding ? { bindPreparedScope(next: SigningResumeScope) {
      entry.assertCurrent();
      const identity = (value: SigningResumeScope | LocalSigningResumeScope) => [
        'adapter' in value ? value.adapter : undefined, value.wallet, value.unlockGeneration, value.accountId,
        value.address, value.type, value.xpub, value.registration, 'grant' in value ? value.grant : undefined,
      ];
      if (continuationOwner.phase !== 'active' || launched || signatureReady || JSON.stringify(identity(scope)) !== JSON.stringify(identity(next)) ||
          next.trezor && !admitted || preparedBound && !sameSigningResumeOwner(scope, next)) throw Error('REQUEST_EXPIRED');
      scope = Object.freeze({ ...next }); preparedBound = true;
    } } : {}), background: () => {
      const launch = marker;
      if (!launch) return false;
      const sameLaunch = () => continuationOwners.get(handoff) === continuationOwner && continuationOwner.phase === 'active' && !signatureReady &&
        marker === launch && launch.scope.trezor && admitted && launch.expiresAt > Date.now() && launch.launchExpiresAt > Date.now();
      try {
        if (!sameLaunch() || !eligible() || !sameLaunch()) return false;
        this.discard();
        if (!sameLaunch() || !eligible() || !sameLaunch()) return false;
        const descriptor = describe(launch.job,launch.expiresAt,launch.scope);
        suspendedToken = launch.token;
        const saved: Suspended = { descriptor, token: launch.token, timer: undefined as unknown as ReturnType<typeof setTimeout>, draining: Promise.resolve().then(() => entry.drain()).catch(() => undefined), claimed: false, continuation: continuationOwner.continuation };
        continuationOwner.continuation = undefined;
        continuationOwner.phase = 'suspended';
        saved.timer = setTimeout(() => this.discard(descriptor), descriptor.expiresAt - Date.now());
        this.suspended = saved;
        entry.retire();
        this.options.changed();
        return this.suspended === saved;
      } catch (error) {
        try { if (this.suspended?.token === launch.token) this.discard(); }
        finally { retireNativeSigningHandoff(handoff); }
        throw error;
      }
    } });
    return handoff;
  }
  background(handoff: NativeSigningHandoff) { return this.controls.get(handoff)?.background() ?? false; }
}
