import { executeSentryCryptoJob } from '../../wallet/sentryCryptoExecution.ts';

import { PRIVATE_PROOF_JOB } from './nativeJobId.ts';
import {
  captureNativeSentryInput,
  eraseNativeSentryInput,
  readNativeSentryMessage,
} from './nativeSentryProtocol.ts';
import type { SentryCryptoJob } from '../../wallet/sentryCryptoJobs.ts';

/** One SDK job in the pinned no-network native asset worker. */
self.onmessage = async (event: MessageEvent) => {
  self.onmessage = null;
  let job: SentryCryptoJob | undefined;
  const id = event.data?.id;
  if (typeof id !== 'string' || !PRIVATE_PROOF_JOB.test(id)) return;
  const emit = (message: object) =>
    self.postMessage({ version: 1, kind: 'sentry', id, ...message });
  try {
    const value = event.data;
    if (!value || Object.keys(value).sort().join(',') !== 'id,job,kind,version')
      throw new Error();
    job = captureNativeSentryInput(
      JSON.stringify({
        version: value.version,
        kind: value.kind,
        job: value.job,
      })
    );
    emit({ type: 'sdk-start' });
    const result = await executeSentryCryptoJob(job, () => undefined);
    const message = readNativeSentryMessage(
      JSON.stringify({
        version: 1,
        kind: 'sentry',
        id,
        type: 'success',
        result,
      }),
      id,
      job
    );
    self.postMessage(message);
  } catch {
    emit({ type: 'error' });
  } finally {
    eraseNativeSentryInput(job);
    eraseNativeSentryInput(event.data?.job);
  }
};
export {};
