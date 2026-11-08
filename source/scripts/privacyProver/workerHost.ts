import type { PrivacyArtifactPolicy } from '../../utils/privacy/proverArtifacts';
import type { IPrivacyProofInput } from '../../utils/privacy/proverTypes';

/** Own every worker, including arithmetic workers which cannot handle cancel messages while busy. */
export function startPrivacyProofWorkers(
  makeWorker: (kind: 'main' | 'sub') => Worker,
  makeChannel: () => MessageChannel,
  policy: PrivacyArtifactPolicy,
  id: string,
  input: IPrivacyProofInput,
  respond: (message: any) => void
) {
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
  const timeout = setTimeout(() => finish({ id, type: 'error' }), 120000);
  try {
    const main = makeWorker('main');
    workers.push(main);
    main.onmessage = (event) => {
      if (!active || event.data?.id !== id) return;
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
  return Object.freeze({ cancel: () => finish(), isRetired: () => retired });
}
