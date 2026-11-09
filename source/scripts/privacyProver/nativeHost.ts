import { privacyPublicSignals } from '../../utils/privacy/proverCore';

import {
  captureNativeProofInput,
  PRIVATE_PROOF_JOB,
  readNativeProofMessage,
} from './nativeProtocol';
import {
  captureNativeSentryInput,
  eraseNativeSentryInput,
  readNativeSentryMessage,
} from './nativeSentryProtocol.ts';
import {
  startPrivacyProofWorkers,
  startSentryCryptoWorker,
} from './workerHost';
import type { IPrivacyProofInput } from '../../utils/privacy/proverTypes';
import type { SentryCryptoJob } from '../../wallet/sentryCryptoJobs.ts';

/** This entry is bundled only into the isolated native proof document. */
export function createNativeProofPage(
  id: string,
  send: (json: string) => void,
  makeWorker: (kind: 'main' | 'sub' | 'sentry') => Worker,
  makeChannel: () => MessageChannel
) {
  if (!PRIVATE_PROOF_JOB.test(id)) throw new Error('privacy_proof_failed');
  let started = false;
  let disposed = false;
  let terminal = false;
  let input: IPrivacyProofInput | undefined;
  let sentry: SentryCryptoJob | undefined;
  let kind: 'proof' | 'sentry' = 'proof';
  let job: ReturnType<typeof startPrivacyProofWorkers> | undefined;
  const emit = (message: object) =>
    send(JSON.stringify({ version: 1, id, ...message }));
  const cancel = (requestId: string) => {
    if (requestId !== id || disposed) return;
    disposed = true;
    const retired = job ? job.cancel() : true;
    if (input) {
      input.nullifier = '';
      input.secret = '';
    }
    eraseNativeSentryInput(sentry);
    if (retired)
      emit({ ...(kind === 'sentry' ? { kind } : {}), type: 'disposed' });
  };
  return Object.freeze({
    ready() {
      emit({ type: 'ready' });
    },
    start(requestId: string, json: string) {
      if (disposed || started || requestId !== id) return;
      started = true;
      try {
        input = captureNativeProofInput(json);
        const expected = privacyPublicSignals(input);
        job = startPrivacyProofWorkers(
          makeWorker,
          makeChannel,
          'bundled',
          id,
          input,
          (message) => {
            if (disposed || terminal) return;
            try {
              const result = readNativeProofMessage(
                JSON.stringify({ version: 1, ...message }),
                id,
                expected
              );
              terminal = result.type !== 'progress';
              send(JSON.stringify(result));
            } catch {
              terminal = true;
              if (job?.cancel()) emit({ type: 'error' });
            }
          }
        );
      } catch {
        terminal = true;
        emit({ type: 'error' });
      }
    },
    startSentry(requestId: string, json: string) {
      if (disposed || started || requestId !== id) return;
      started = true;
      kind = 'sentry';
      try {
        sentry = captureNativeSentryInput(json);
        job = startSentryCryptoWorker(
          () => makeWorker('sentry'),
          id,
          sentry,
          (message) => {
            if (disposed || terminal) return;
            try {
              const result = readNativeSentryMessage(
                JSON.stringify(message),
                id,
                sentry!
              );
              if (result.type === 'disposed') throw new Error();
              terminal = result.type !== 'sdk-start';
              send(JSON.stringify(result));
            } catch {
              terminal = true;
              if (job?.cancel()) emit({ kind: 'sentry', type: 'error' });
            }
          }
        );
      } catch {
        terminal = true;
        emit({ kind: 'sentry', type: 'error' });
      }
    },
    cancel,
    cancelSentry(requestId: string) {
      if (requestId !== id || (started && kind !== 'sentry')) return;
      kind = 'sentry';
      cancel(requestId);
    },
  });
}
