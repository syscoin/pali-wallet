import type { NativeConnectionBinding } from './storage.ts';
import type { WalletConnectRequest } from './walletConnect.ts';

/** Public request correlation only; no old approval, keyring or signing context survives lock. */
export type NativeSigningHandoff = Readonly<{
  id: string;
  beforeSuiteOpen(expiresAt: number, job: object): (opened: boolean) => void;
  beforeSignature(): void;
  isSuspended(): boolean;
}>;
export type SigningResumeScope = Readonly<{ adapter: number; wallet: string; unlockGeneration: number; accountId: string; address: string; type: string; xpub: string; registration: string; grant: string }>;
export const sameSigningResumeOwner = (a: SigningResumeScope, b: SigningResumeScope) => {
  const { unlockGeneration: _a, ...left } = a, { unlockGeneration: _b, ...right } = b;
  return JSON.stringify(left) === JSON.stringify(right);
};
export type SigningHandoffDescriptor = Readonly<{
  id: string; binding: NativeConnectionBinding; requestId: number; wire: string;
  scope: SigningResumeScope; expiresAt: number; order: number; job: object;
}>;
type Entry = Readonly<{
  id: string; wire: WalletConnectRequest; scope: SigningResumeScope; expiresAt: number; order: number;
  assertCurrent(): void; eligible(): boolean; drain(): Promise<unknown>; retire(): void;
}>;
type Suspended = { descriptor: SigningHandoffDescriptor; token: object; timer: ReturnType<typeof setTimeout>; draining: Promise<unknown> };
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
  count(topic: string) { return this.suspended?.descriptor.binding.topic === topic ? 1 : 0; }
  has(wire: WalletConnectRequest) { return this.suspended?.descriptor.requestId === wire.id && this.suspended.descriptor.binding.topic === wire.session.binding.topic; }
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
  descriptor(id: string) {
    const saved = this.suspended;
    if (saved && saved.descriptor.expiresAt <= Date.now()) { this.discard(saved.descriptor); return null; }
    return saved?.descriptor.id === id ? saved.descriptor : null;
  }
  cancel() { const descriptor = this.suspended?.descriptor; this.discard(descriptor); return descriptor; }
  async drain(id: string) {
    const saved = this.suspended;
    if (!saved || !this.descriptor(id)) throw Error('REQUEST_EXPIRED');
    await saved.draining;
    if (this.suspended !== saved || !this.descriptor(id)) throw Error('REQUEST_EXPIRED');
  }
  revalidate(check: (descriptor: SigningHandoffDescriptor) => boolean) { if (this.suspended && !check(this.suspended.descriptor)) this.discard(); }
  expire(id: number) { if (this.suspended?.descriptor.requestId === id) this.discard(); }
  retired() { return this.retirement; }
  capture(entry: Entry): NativeSigningHandoff {
    // This flag comes from trusted transport admission, never request parameters.
    // Capture refuses an unproven original; unlock or pending lookup cannot promote it.
    const fresh = entry.wire.freshness === 'fresh', scope = Object.freeze({ ...entry.scope });
    if (scope.type === 'Trezor' && !fresh) throw Error('REQUEST_EXPIRED');
    const wire = JSON.stringify(entry.wire), requestId = entry.wire.id, binding = Object.freeze({ ...entry.wire.session.binding });
    let marker: { token: object; expiresAt: number; launchExpiresAt: number; job: object } | undefined;
    let suspendedToken: object | undefined, signatureReady = false;
    const eligible = () => !signatureReady && entry.eligible();
    const handoff: NativeSigningHandoff = Object.freeze({ id: entry.id,
      beforeSuiteOpen: (expiresAt, job) => {
        entry.assertCurrent();
        if (scope.type !== 'Trezor' || !fresh || !eligible() || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !job || typeof job !== 'object') throw Error('REQUEST_EXPIRED');
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
      if (!marker || scope.type !== 'Trezor' || !fresh || !eligible() || marker.expiresAt <= Date.now() || marker.launchExpiresAt <= Date.now()) return false;
      this.discard();
      const descriptor: SigningHandoffDescriptor = Object.freeze({ id: entry.id, binding,
        requestId, wire, scope, expiresAt: marker.expiresAt, order: entry.order, job: marker.job });
      suspendedToken = marker.token;
      const saved: Suspended = { descriptor, token: marker.token, timer: undefined as unknown as ReturnType<typeof setTimeout>, draining: entry.drain().catch(() => undefined) };
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
