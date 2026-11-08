import { privacyPublicSignals } from '../../utils/privacy/proverCore';

import {
  captureNativeProofInput,
  PRIVATE_PROOF_JOB,
  readNativeProofMessage,
} from './nativeProtocol';
import { startPrivacyProofWorkers } from './workerHost';
import type { IPrivacyProofInput } from '../../utils/privacy/proverTypes';

/** This entry is bundled only into the isolated native proof document. */
export function createNativeProofPage(
  id: string,
  send: (json: string) => void,
  makeWorker: (kind: 'main' | 'sub') => Worker,
  makeChannel: () => MessageChannel
) {
  if (!PRIVATE_PROOF_JOB.test(id)) throw new Error('privacy_proof_failed');
  let started = false;
  let disposed = false;
  let terminal = false;
  let input: IPrivacyProofInput | undefined;
  let job: ReturnType<typeof startPrivacyProofWorkers> | undefined;
  const emit = (message: object) =>
    send(JSON.stringify({ version: 1, id, ...message }));
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
    cancel(requestId: string) {
      if (requestId !== id || disposed) return;
      disposed = true;
      const retired = job ? job.cancel() : true;
      if (input) {
        input.nullifier = '';
        input.secret = '';
      }
      if (retired) emit({ type: 'disposed' });
    },
  });
}
