import { executeSentryCryptoJob } from '../../wallet/sentryCryptoExecution';

import type { SentryCryptoJob } from '../../wallet/sentryCryptoJobs';

self.onmessage = async (event: MessageEvent<{ job: SentryCryptoJob }>) => {
  try {
    const result = await executeSentryCryptoJob(
      event.data.job,
      () => undefined
    );
    self.postMessage({ success: true, result });
  } catch {
    // Never forward library errors that might contain caller-supplied secrets.
    self.postMessage({
      success: false,
      error: 'Sentry key validation or authorization failed',
    });
  }
};
