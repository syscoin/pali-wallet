import { ensureNativeCryptoReady } from '../platform/cryptoBootstrap';
import { createSentryCryptoExecutor } from './sentryCryptoExecutor';
import type { RunSentryCrypto } from '../../../../source/wallet/sentryCryptoJobs.ts';

/** Installed separately from public-key import qualification. */
export function createNativeSentryCryptoExecutor(
  isolated: RunSentryCrypto | null
) {
  return createSentryCryptoExecutor(async () => {
    await ensureNativeCryptoReady();
    const { executeSentryCryptoJob } = await import(
      '../../../../source/wallet/sentryCryptoExecution.ts'
    );
    return executeSentryCryptoJob;
  }, isolated);
}
