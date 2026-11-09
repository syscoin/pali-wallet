import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
} from '../../../../source/utils/privacy/proverTypes';
import type { RunSentryCrypto } from '../../../../source/wallet/sentryCryptoJobs.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { nativeExecutionError } from '../../../../source/scripts/privacyProver/nativeExecutionDiagnostic.ts';

// Imported only by the explicit qualification path until native qualification is complete.
// Loading this entry does not create a WebView or import the proof arithmetic.
export async function runNativePrivacyProof(
  input: IPrivacyProofInput,
  options: IPrivacyProofOptions
) {
  const { requireNativeModule } = await import('expo-modules-core');
  const { runProof } = await import('./runner');
  return runProof(requireNativeModule('PaliPrivateProver'), input, options);
}

/** Only the fixed pinned SDK dispatcher runs in the same isolated asset host. */
export const runNativeSentryCrypto: RunSentryCrypto = async (
  job,
  assertCurrent
) => {
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  check();
  try {
    const { requireNativeModule } = await import('expo-modules-core');
    const { runSentryJob } = await import('./runner');
    check();
    return await runSentryJob(requireNativeModule('PaliPrivateProver'), job, {
      assertCurrent: check,
    });
  } catch (error) {
    check();
    throw nativeExecutionError('SENTRY_EXECUTION_FAILED', error);
  }
};
