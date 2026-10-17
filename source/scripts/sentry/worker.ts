import {
  importSentryAuthorityKey,
  signSentryManagementOperation,
  signSentryOperation,
} from '@sidhujag/sysweb3-sentry';

import type { SentryCryptoJob } from 'utils/sentry/workerClient';

self.onmessage = async (event: MessageEvent<{ job: SentryCryptoJob }>) => {
  try {
    const { job } = event.data;
    if (
      job.type === 'sign' &&
      (job.key.role !== 'operator' || job.key.scheme === 'secp256k1')
    )
      throw new Error('Service updates require the registered operator');
    const result =
      job.type === 'import'
        ? await importSentryAuthorityKey(job.role, job.scheme, job.secretKey)
        : job.type === 'sign'
        ? await signSentryOperation(job.request, job.context, {
            ...job.key,
            scheme: job.key.scheme as 'bls-basic' | 'slh-dsa-shake-128s',
          })
        : job.type === 'signManagement'
        ? await signSentryManagementOperation(
            job.request,
            job.context,
            job.key,
            job.authorizationId
          )
        : undefined;
    if (!result) throw new Error('Unsupported Sentry operation');
    self.postMessage({ success: true, result });
  } catch {
    // Never forward library errors that might contain caller-supplied secrets.
    self.postMessage({
      success: false,
      error: 'Sentry key validation or authorization failed',
    });
  }
};
