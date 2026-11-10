import type { NativeOperationCredential, NativeOperationCredentialRequest, NativeOperationCredentialRequester } from '../custody/types.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

export type OperationAuthenticationPrompt = Readonly<{
  request: NativeOperationCredentialRequest;
  confirm(credential: NativeOperationCredential): void;
  cancel(): void;
}>;
const explicitCancellations = new WeakSet<object>();
/** Only a current prompt's explicit Cancel can preserve its public owner. */
export function isOperationAuthenticationCancellation(error: unknown): error is Error {
  return !!error && typeof error === 'object' && explicitCancellations.has(error);
}

function captureCredential(value: unknown, biometricsEnabled: boolean): NativeOperationCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CANCELLED');
  const own = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(own);
  const method = own.method && 'value' in own.method ? own.method.value : null;
  if (method === 'biometric' && names.length === 1 && biometricsEnabled) return Object.freeze({ method });
  if (method === 'pin' && names.length === 2 && own.pin && 'value' in own.pin && typeof own.pin.value === 'string' && /^\d{6}$/.test(own.pin.value))
    return Object.freeze({ method, pin: own.pin.value });
  throw new Error('CANCELLED');
}

/** One mounted native host, one exact operation, and no queued credential prompts. */
export class OperationAuthentication {
  private readonly now: () => number;
  private host: Readonly<{ show(prompt: OperationAuthenticationPrompt | null): void }> | null = null;
  private pending: Readonly<{ cancel(): void }> | null = null;

  constructor(now: () => number = () => performance.now()) { this.now = now; }

  attach(show: (prompt: OperationAuthenticationPrompt | null) => void): () => void {
    if (this.host) throw new Error('BUSY');
    const host = { show };
    this.host = host;
    return () => {
      if (this.host !== host) return;
      this.host = null;
      this.pending?.cancel();
    };
  }

  cancel = (): void => { this.pending?.cancel(); };

  request: NativeOperationCredentialRequester = (request, signal, assertCurrent) => {
    try { assertSynchronousEvmFeeGuard(assertCurrent); } catch { return Promise.reject(new Error('CANCELLED')); }
    const host = this.host;
    if (!host || signal.aborted) return Promise.reject(new Error('CANCELLED'));
    if (this.pending) return Promise.reject(new Error('BUSY'));
    const metadata = Object.freeze({ ...request });
    const started = this.now();
    if (!Number.isFinite(started)) return Promise.reject(new Error('CANCELLED'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const active = () => {
        const now = this.now();
        if (settled || this.host !== host || this.pending !== pending || signal.aborted || !Number.isFinite(now) || now < started || now - started >= 90_000) throw new Error('CANCELLED');
        assertSynchronousEvmFeeGuard(assertCurrent);
      };
      const finish = (credential?: NativeOperationCredential, explicitCancel = false) => {
        if (settled) return;
        let failure: unknown;
        let admitted: NativeOperationCredential | undefined;
        let canPreserve = false;
        try {
          active();
          if (explicitCancel) { failure = new Error('CANCELLED'); canPreserve = true; }
          else admitted = captureCredential(credential, metadata.biometricsEnabled);
        } catch (error) { failure = error; }
        settled = true;
        clearTimeout(timer); signal.removeEventListener('abort', cancel);
        if (this.pending === pending) this.pending = null;
        try { if (this.host === host) host.show(null); } catch { failure = new Error('CANCELLED'); canPreserve = false; }
        try {
          if (this.host !== host || signal.aborted) throw new Error('CANCELLED');
          assertSynchronousEvmFeeGuard(assertCurrent);
        } catch (error) { failure = error; canPreserve = false; }
        if (canPreserve && failure && typeof failure === 'object') explicitCancellations.add(failure);
        if (failure || !admitted) reject(failure ?? new Error('CANCELLED'));
        else resolve(admitted);
      };
      const cancel = () => finish();
      const pending = { cancel };
      this.pending = pending;
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, 90_000);
      try {
        active();
        host.show(Object.freeze({ request: metadata, confirm: (credential: NativeOperationCredential) => finish(credential), cancel: () => finish(undefined, true) }));
      } catch { cancel(); }
    });
  };
}
