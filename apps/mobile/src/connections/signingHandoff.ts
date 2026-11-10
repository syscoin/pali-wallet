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
type Suspended = { descriptor: Descriptor; token: object; timer: ReturnType<typeof setTimeout>; draining: Promise<unknown> };
function freezePublicJson<T>(value: T): T {
  if(value&&typeof value==='object'){for(const child of Object.values(value))freezePublicJson(child);Object.freeze(value);}
  return value;
}
/** One bounded Suite departure policy shared by structured PSBT and EVM/message requests. */
export class NativeSigningHandoffs {
  private suspended: Suspended | undefined;
  private retirement: Promise<void> = Promise.resolve();
  private readonly controls = new WeakMap<NativeSigningHandoff, () => boolean>();
  private readonly options: Readonly<{ cancel(job: object): Promise<void>; changed(): void }>;
  constructor(options: NativeSigningHandoffs['options']) { this.options = options; }
  get active() { return this.suspended !== undefined; }
  get firstOrder() { return this.suspended?.descriptor.order ?? Infinity; }
  get size() { return this.suspended ? 1 : 0; }
  count(topic: string) { const value=this.suspended?.descriptor; return value?.kind === 'dapp' && value.binding.topic === topic ? 1 : 0; }
  has(wire: WalletConnectRequest) { const value=this.suspended?.descriptor; return value?.kind === 'dapp' && value.requestId === wire.id && value.binding.topic === wire.session.binding.topic; }
  discard(descriptor = this.suspended?.descriptor, cancel = true) {
    const saved = this.suspended;
    if (!saved || saved.descriptor !== descriptor) return;
    clearTimeout(saved.timer); this.suspended = undefined;
    if (cancel) {
      this.retirement = this.retirement.then(() => this.options.cancel(saved.descriptor.job));
      void this.retirement.catch(() => undefined);
    }
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
    const fresh = entry.wire.freshness === 'fresh', scope = Object.freeze({ ...entry.scope });
    if (scope.trezor && !fresh) throw Error('REQUEST_EXPIRED');
    const wire=JSON.stringify(entry.wire),requestId=entry.wire.id,binding=Object.freeze({...entry.wire.session.binding});
    return this.captureState(entry,fresh,(job,expiresAt)=>Object.freeze({kind:'dapp',id:entry.id,binding,requestId,wire,scope,expiresAt,order:entry.order,job}));
  }
  captureLocal(entry: LocalEntry, snapshotAction: (action: NativeSmartLocalAction) => NativeSmartLocalAction): NativeSigningHandoff {
    // Locally initiated public actions have a distinct admission source; they
    // never acquire WalletConnect freshness, topic or grant by fabrication.
    // The required local DTO capture keeps asset/signing dependencies out of PSBT transport.
    entry.assertCurrent(); measureJsonWorkBudget(entry.action,DAPP_REQUEST_LIMITS.bytes);
    const action = freezePublicJson(snapshotAction(entry.action)),scope=Object.freeze({...entry.scope});
    return this.captureState(entry,true,(job,expiresAt)=>Object.freeze({kind:'local-smart',id:entry.id,action,scope,expiresAt,order:entry.order,job}));
  }
  private captureState(entry: Capture, admitted: boolean, describe: (job: object, expiresAt: number) => Descriptor): NativeSigningHandoff {
    const scope=Object.freeze({...entry.scope});
    let marker: { token: object; expiresAt: number; launchExpiresAt: number; job: object } | undefined;
    let suspendedToken: object | undefined, signatureReady = false;
    const eligible = () => !signatureReady && entry.eligible();
    const handoff: NativeSigningHandoff = Object.freeze({ id: entry.id, expiresAt: entry.expiresAt,
      beforeSuiteOpen: (expiresAt, job) => {
        entry.assertCurrent();
        if (!scope.trezor || !admitted || !eligible() || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !job || typeof job !== 'object') throw Error('REQUEST_EXPIRED');
        const launch = { token: {}, job, expiresAt: Math.min(expiresAt, entry.expiresAt), launchExpiresAt: Math.min(Date.now() + 5000, expiresAt, entry.expiresAt) };
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
    this.controls.set(handoff, () => {
      if (!marker || !scope.trezor || !admitted || !eligible() || marker.expiresAt <= Date.now() || marker.launchExpiresAt <= Date.now()) return false;
      this.discard();
      const descriptor = describe(marker.job,marker.expiresAt);
      suspendedToken = marker.token;
      const saved: Suspended = { descriptor, token: marker.token, timer: undefined as unknown as ReturnType<typeof setTimeout>, draining: Promise.resolve().then(() => entry.drain()).catch(() => undefined) };
      saved.timer = setTimeout(() => this.discard(descriptor), descriptor.expiresAt - Date.now());
      this.suspended = saved;
      entry.retire();
      this.options.changed();
      return true;
    });
    return handoff;
  }
  background(handoff: NativeSigningHandoff) { return this.controls.get(handoff)?.() ?? false; }
}
