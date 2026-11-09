import {
  captureNativeProofInput,
  readNativeProofMessage,
} from '../../../../source/scripts/privacyProver/nativeProtocol';
import { privacyPublicSignals } from '../../../../source/utils/privacy/proverCore';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard';
import {
  privacyProofAbortError,
  privacyProofGuardError,
} from '../../../../source/utils/privacy/proverErrors';
import {
  captureNativeSentryInput,
  eraseNativeSentryInput,
  readNativeSentryMessage,
} from '../../../../source/scripts/privacyProver/nativeSentryProtocol.ts';
import type {
  SentryCryptoJob,
  SentryCryptoResult,
} from '../../../../source/wallet/sentryCryptoJobs.ts';
import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
  IPrivacyProofResult,
} from '../../../../source/utils/privacy/proverTypes';
import { nativeBridgeExecutionError, nativeExecutionError } from '../../../../source/scripts/privacyProver/nativeExecutionDiagnostic.ts';

interface NativeResourceContext {
  close(): void;
  dispose(): Promise<void>;
  addListener(
    event: 'progress',
    listener: (json: string) => void
  ): { remove(): void };
}
interface NativeProofContext extends NativeResourceContext {
  run(id: string, input: string): Promise<string>;
}
interface NativeSentryContext extends NativeResourceContext {
  runSentry(id: string, input: string): Promise<string>;
}
export interface NativeProofModule {
  createHost(): NativeProofContext;
}
export interface NativeSentryModule {
  createHost(): NativeSentryContext;
}
type JobMessage<T> = {
  type: string;
  result?: T;
  progress?: Parameters<NonNullable<IPrivacyProofOptions['onProgress']>>[0];
};
type CapturedJob<T> = {
  json: string;
  erase(): void;
  read(json: string, id: string): JobMessage<T>;
};

let active = false;
let retirementFailed = false;

/** No waiting queue retains private inputs. Both JS and native hold admission through disposal. */
async function runOwnedJob<Context extends NativeResourceContext, Result>(
  native: { createHost(): Context },
  plan: {
    capture(): CapturedJob<Result>;
    run(context: Context, id: string, input: string): Promise<string>;
  },
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
  let context: Context | undefined;
  let subscription: { remove(): void } | undefined;
  let input: CapturedJob<Result> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let revoked = false;
  let sdkStarted = false;
  let revocationError = privacyProofAbortError(undefined);
  let result: Result;
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
    input = plan.capture();
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
        const message = input!.read(json, id);
        if (message.type === 'sdk-start') {
          if (sdkStarted) throw new Error('privacy_proof_failed');
          sdkStarted = true;
          return;
        }
        if (message.type !== 'progress')
          throw new Error('privacy_proof_failed');
        if (!message.progress) throw new Error('privacy_proof_failed');
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
    timer = setTimeout(() => revoke(nativeExecutionError('privacy_proof_cancelled', { nativeExecutionCode: sdkStarted ? 'sdk-job-timeout' : 'job-timeout' })), 120000);
    check();
    const pending = plan.run(context, id, input.json).catch(error => {
      // Retain the existing fixed pending outcome without inspecting native
      // accessors or forwarding arbitrary exception messages.
      let verificationPending = false;
      try {
        const message = error instanceof Error && Object.getOwnPropertyDescriptor(error, 'message');
        verificationPending = !!message && 'value' in message && message.value === 'privacy_verification_pending';
      } catch { /* Unknown native failures retain the generic refusal. */ }
      const guarded = privacyProofGuardError(verificationPending ? new Error('privacy_verification_pending') : undefined);
      throw nativeBridgeExecutionError(guarded.message === 'privacy_verification_pending' ? 'privacy_verification_pending' : 'privacy_proof_failed', error);
    });
    input.json = '';
    input.erase();
    const json = await Promise.race([pending, cancellation]);
    check();
    const message = input.read(json, id);
    if (message.type !== 'success' || message.result === undefined)
      throw new Error('privacy_proof_failed');
    result = message.result;
  } catch (error) {
    if (revoked) throw revocationError;
    const guarded = privacyProofGuardError(error);
    throw nativeExecutionError(guarded.message === 'privacy_verification_pending' ? 'privacy_verification_pending' : 'privacy_proof_failed', error);
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
      input.json = '';
      input.erase();
    }
    try {
      try {
        context?.close();
      } finally {
        await context?.dispose();
      }
    } catch (error) {
      retirementFailed = true;
      throw nativeBridgeExecutionError('privacy_proof_unavailable', error);
    } finally {
      active = false;
    }
  }
  assertCurrent();
  if (options.signal?.aborted)
    throw privacyProofAbortError(options.signal.reason);
  return result;
}

/** The original proof contract retains its exact input, public signals and progress parser. */
export function runProof(
  native: NativeProofModule,
  original: IPrivacyProofInput,
  options: IPrivacyProofOptions
) {
  return runOwnedJob<NativeProofContext, IPrivacyProofResult>(
    native,
    {
      capture() {
        const input = captureNativeProofInput(JSON.stringify(original));
        const expected = privacyPublicSignals(input);
        return {
          json: JSON.stringify(input),
          erase() {
            input.nullifier = '';
            input.secret = '';
          },
          read: (json, id) => readNativeProofMessage(json, id, expected),
        };
      },
      run: (context, id, input) => context.run(id, input),
    },
    options
  );
}

/** Fixed SDK job domain shares admission, cancellation and acknowledged disposal with proofs. */
export function runSentryJob<T extends SentryCryptoResult>(
  native: NativeSentryModule,
  original: SentryCryptoJob,
  options: Pick<IPrivacyProofOptions, 'assertCurrent' | 'signal'>
): Promise<T> {
  return runOwnedJob<NativeSentryContext, T>(
    native,
    {
      capture() {
        const job = captureNativeSentryInput(
          JSON.stringify({ version: 1, kind: 'sentry', job: original })
        );
        return {
          json: JSON.stringify({ version: 1, kind: 'sentry', job }),
          erase: () => eraseNativeSentryInput(job),
          read(json, id) {
            return readNativeSentryMessage(json, id, job) as JobMessage<T>;
          },
        };
      },
      run: (context, id, input) => context.runSentry(id, input),
    },
    options
  );
}
