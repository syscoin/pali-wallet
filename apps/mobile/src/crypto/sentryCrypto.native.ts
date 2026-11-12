import { ensureNativeCryptoReady } from '../platform/cryptoBootstrap';
import { createSentryCryptoExecutor } from './sentryCryptoExecutor';
import type { RunSentryCrypto } from '../../../../source/wallet/sentryCryptoJobs.ts';

/** SHAKE jobs run only in the fixed native isolated host after bootstrap. */
export function createNativeSentryCryptoExecutor(): RunSentryCrypto {
  return createSentryCryptoExecutor(async () => {
    await ensureNativeCryptoReady();
    const { executeSentryCryptoJob } = await import(
      '../../../../source/wallet/sentryCryptoExecution.ts'
    );
    return executeSentryCryptoJob;
  }, async (job, assertCurrent) => {
    await ensureNativeCryptoReady();
    assertCurrent();
    const { runNativeSentryCrypto } = await import('../../modules/pali-private-prover');
    assertCurrent();
    return runNativeSentryCrypto(job, assertCurrent);
  });
}
