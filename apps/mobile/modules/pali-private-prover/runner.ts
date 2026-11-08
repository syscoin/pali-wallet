import {
  captureNativeProofInput,
  readNativeProofMessage,
} from '../../../../source/scripts/privacyProver/nativeProtocol';
import { privacyPublicSignals } from '../../../../source/utils/privacy/proverCore';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval';
import {
  privacyProofAbortError,
  privacyProofGuardError,
} from '../../../../source/utils/privacy/proverErrors';
import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
  IPrivacyProofResult,
} from '../../../../source/utils/privacy/proverTypes';

interface NativeProofContext {
  run(id: string, input: string): Promise<string>;
  close(): void;
  dispose(): Promise<void>;
  addListener(
    event: 'progress',
    listener: (json: string) => void
  ): { remove(): void };
}
export interface NativeProofModule {
  createHost(): NativeProofContext;
}

let active = false;
let retirementFailed = false;

/** No waiting queue retains private inputs. Both JS and native hold admission through disposal. */
export async function runProof(
  native: NativeProofModule,
  original: IPrivacyProofInput,
  options: IPrivacyProofOptions
) {
  const assertCurrent = () =>
    assertSynchronousEvmFeeGuard(options.assertCurrent);
  assertCurrent();
  if (options.signal?.aborted)
    throw privacyProofAbortError(options.signal.reason);
  if (active) throw new Error('privacy_proof_busy');
  if (retirementFailed) throw new Error('privacy_proof_unavailable');
  active = true;
  let context: NativeProofContext | undefined;
  let subscription: { remove(): void } | undefined;
  let input: IPrivacyProofInput | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let revoked = false;
  let revocationError = privacyProofAbortError(undefined);
  let result: IPrivacyProofResult;
  let rejectRevoked: (error: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectRevoked = reject;
  });
  // Attach a handler before any synchronous native callback can revoke authority.
  void cancellation.catch(() => undefined);
  const revoke = (error: Error) => {
    if (revoked) return;
    revoked = true;
    revocationError = error;
    try {
      context?.close();
    } catch {
      retirementFailed = true;
    }
    rejectRevoked(revocationError);
  };
  const externalAbort = () =>
    revoke(privacyProofAbortError(options.signal?.reason));
  try {
    input = captureNativeProofInput(JSON.stringify(original));
    const expected = privacyPublicSignals(input);
    const id = crypto.randomUUID();
    assertCurrent();
    if (options.signal?.aborted)
      throw privacyProofAbortError(options.signal.reason);
    context = native.createHost();
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) externalAbort();
    const check = () => {
      if (revoked) throw revocationError;
      assertCurrent();
    };
    subscription = context.addListener('progress', (json) => {
      try {
        check();
        const message = readNativeProofMessage(json, id, expected);
        if (message.type !== 'progress')
          throw new Error('privacy_proof_failed');
        options.onProgress?.(message.progress);
      } catch (error) {
        revoke(privacyProofGuardError(error));
      }
    });
    poll = setInterval(() => {
      try {
        check();
      } catch (error) {
        revoke(privacyProofAbortError(error));
      }
    }, 250);
    timer = setTimeout(() => revoke(privacyProofAbortError(undefined)), 120000);
    check();
    const pending = context.run(id, JSON.stringify(input));
    input.nullifier = '';
    input.secret = '';
    const json = await Promise.race([pending, cancellation]);
    check();
    const message = readNativeProofMessage(json, id, expected);
    if (message.type !== 'success') throw new Error('privacy_proof_failed');
    result = message.result;
  } catch (error) {
    throw revoked ? revocationError : privacyProofGuardError(error);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    revoked = true;
    options.signal?.removeEventListener('abort', externalAbort);
    try {
      subscription?.remove();
    } catch {
      /* Authority is already revoked. */
    }
    if (input) {
      input.nullifier = '';
      input.secret = '';
    }
    try {
      try {
        context?.close();
      } finally {
        await context?.dispose();
      }
    } catch {
      retirementFailed = true;
      throw new Error('privacy_proof_unavailable');
    } finally {
      active = false;
    }
  }
  assertCurrent();
  if (options.signal?.aborted)
    throw privacyProofAbortError(options.signal.reason);
  return result;
}
