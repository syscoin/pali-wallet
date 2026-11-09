import {
  eraseNativeSentryInput,
  readNativeSentryMessage,
} from './nativeSentryProtocol.ts';
import type { PrivacyArtifactPolicy } from '../../utils/privacy/proverArtifacts';
import type { IPrivacyProofInput } from '../../utils/privacy/proverTypes';
import type { SentryCryptoJob } from '../../wallet/sentryCryptoJobs.ts';

/** Own every worker, including arithmetic workers which cannot handle cancel messages while busy. */
function ownWorkers(respond: (message: any) => void, error: object) {
  const workers: Worker[] = [];
  const channels: MessageChannel[] = [];
  let active = true;
  let retired = false;
  const finish = (message?: unknown) => {
    if (!active) return retired;
    active = false;
    clearTimeout(timeout);
    let cleanupSucceeded = true;
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch {
        cleanupSucceeded = false;
      }
    }
    for (const channel of channels) {
      try {
        channel.port1.close();
      } catch {
        cleanupSucceeded = false;
      }
      try {
        channel.port2.close();
      } catch {
        cleanupSucceeded = false;
      }
    }
    retired = cleanupSucceeded;
    // A native host must not treat a result as evidence of worker retirement
    // when a termination/port-close call failed. Its disposal watchdog closes it.
    if (message && retired) respond(message);
    return retired;
  };
  const timeout = setTimeout(() => finish(error), 120000);
  return {
    workers,
    channels,
    finish,
    active: () => active,
    cancel: () => finish(),
    isRetired: () => retired,
  };
}

export function startPrivacyProofWorkers(
  makeWorker: (kind: 'main' | 'sub') => Worker,
  makeChannel: () => MessageChannel,
  policy: PrivacyArtifactPolicy,
  id: string,
  input: IPrivacyProofInput,
  respond: (message: any) => void
) {
  const owner = ownWorkers(respond, { id, type: 'error' });
  const { workers, channels, finish } = owner;
  try {
    const main = makeWorker('main');
    workers.push(main);
    main.onmessage = (event) => {
      if (!owner.active() || event.data?.id !== id) return;
      if (event.data.type === 'progress') respond(event.data);
      else finish(event.data);
    };
    const fail = () => finish({ id, type: 'error' });
    main.onerror = fail;
    const ports: MessagePort[] = [];
    for (let index = 0; index < 2; index++) {
      const worker = makeWorker('sub');
      workers.push(worker);
      worker.onerror = fail;
      const channel = makeChannel();
      channels.push(channel);
      ports.push(channel.port1);
      worker.postMessage({ port: channel.port2 }, [channel.port2]);
    }
    main.postMessage({ id, input, ports, policy }, ports);
  } catch {
    finish({ id, type: 'error' });
  } finally {
    if (input && typeof input === 'object') {
      input.nullifier = '';
      input.secret = '';
    }
  }
  return Object.freeze({ cancel: owner.cancel, isRetired: owner.isRetired });
}

/** The same retirement boundary owns a single, fixed SDK execution worker. */
export function startSentryCryptoWorker(
  makeWorker: () => Worker,
  id: string,
  job: SentryCryptoJob,
  respond: (message: any) => void
) {
  const error = { version: 1, kind: 'sentry', id, type: 'error' };
  const owner = ownWorkers(respond, error);
  let sdkStarted = false;
  try {
    const worker = makeWorker();
    owner.workers.push(worker);
    worker.onmessage = (event) => {
      if (!owner.active()) return;
      if (event.data?.type !== 'sdk-start') {
        owner.finish(event.data);
        return;
      }
      try {
        const message = readNativeSentryMessage(
          JSON.stringify(event.data),
          id,
          job
        );
        if (sdkStarted) throw new Error();
        sdkStarted = true;
        respond(message);
      } catch {
        owner.finish(error);
      }
    };
    worker.onerror = () => owner.finish(error);
    worker.postMessage({ version: 1, kind: 'sentry', id, job });
  } catch {
    owner.finish(error);
  } finally {
    eraseNativeSentryInput(job);
  }
  return Object.freeze({ cancel: owner.cancel, isRetired: owner.isRetired });
}
