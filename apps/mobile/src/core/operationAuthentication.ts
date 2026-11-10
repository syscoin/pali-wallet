import type { NativeOperationCredential, NativeOperationCredentialRequest, NativeOperationCredentialRequester } from '../custody/types.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

export type OperationAuthenticationPrompt = Readonly<{
  request: NativeOperationCredentialRequest;
  busy: boolean;
  error?: string;
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
  private pending: Readonly<{ cancel(): void; isVerifying(): boolean }> | null = null;

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
  isVerifying = (): boolean => this.pending?.isVerifying() === true;

  request: NativeOperationCredentialRequester = (request, signal, assertCurrent, verify) => {
    try { assertSynchronousEvmFeeGuard(assertCurrent); } catch { return Promise.reject(new Error('CANCELLED')); }
    const host = this.host;
    if (!host || signal.aborted) return Promise.reject(new Error('CANCELLED'));
    if (this.pending) return Promise.reject(new Error('BUSY'));
    const metadata = Object.freeze({ ...request });
    const started = this.now();
    if (!Number.isFinite(started)) return Promise.reject(new Error('CANCELLED'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let verifying = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const active = () => {
        const now = this.now();
        if (settled || this.host !== host || this.pending !== pending || signal.aborted || !Number.isFinite(now) || now < started || now - started >= 90_000) throw new Error('CANCELLED');
        assertSynchronousEvmFeeGuard(assertCurrent);
      };
      const finish = (failure?: unknown, explicitCancel = false) => {
        if (settled) return;
        let canPreserve = false;
        try {
          active();
          if (explicitCancel) { failure = new Error('CANCELLED'); canPreserve = true; }
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
        if (failure) reject(failure);
        else resolve();
      };
      const cancel = () => finish(new Error('CANCELLED'));
      const pending = { cancel, isVerifying: () => !settled && verifying };
      const show = (busy: boolean, error?: string) => host.show(Object.freeze({
        request: metadata, busy, error,
        confirm: (credential: NativeOperationCredential) => { void confirm(credential); },
        cancel: () => finish(undefined, true),
      }));
      const confirm = async (value: NativeOperationCredential | null) => {
        if (settled || verifying) return;
        let credential: NativeOperationCredential | null = null;
        try {
          active();
          credential = captureCredential(value, metadata.biometricsEnabled);
          value = null;
          verifying = true;
          show(true);
          active();
          const result = await verify(credential, active);
          active();
          if (result.accepted === true) { finish(); return; }
          const error = result.reason === 'INVALID_CREDENTIAL' ? 'PIN not accepted. Try again.'
            : result.reason === 'DEVICE_UNLOCK_UNAVAILABLE' ? 'Authentication was not completed. Enter your PIN or try again.'
              : result.reason === 'AUTH_THROTTLED' ? 'Too many attempts. Wait before trying again.' : null;
          if (!error) throw new Error('CANCELLED');
          verifying = false;
          show(false, error);
        } catch (error) {
          finish(error);
        } finally { credential = null; }
      };
      this.pending = pending;
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, 90_000);
      try {
        active();
        show(false);
      } catch { cancel(); }
    });
  };
}
