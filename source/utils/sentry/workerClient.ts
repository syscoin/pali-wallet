import { ensureOffscreenDocument } from 'utils/slhDsa/offscreenClient';

import type {
  SentryCryptoJob,
  SentryCryptoResult,
} from '../../wallet/sentryCryptoJobs';
export type { SentryCryptoJob } from '../../wallet/sentryCryptoJobs';

export const runSentryCrypto = async <T extends SentryCryptoResult>(
  job: SentryCryptoJob,
  assertCurrent: () => void
): Promise<T> => {
  assertCurrent();
  await ensureOffscreenDocument();
  assertCurrent();
  const response = await chrome.runtime.sendMessage({
    type: 'PALI_SENTRY_CRYPTO',
    job,
  });
  assertCurrent();
  if (!response || response.success !== true || !response.result)
    throw new Error(
      response?.error || 'Sentry cryptographic operation did not complete'
    );
  return response.result;
};
