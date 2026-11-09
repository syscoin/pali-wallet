import { parentPort } from 'node:worker_threads';

// Fixed test transport around the exact production Worker entry; no crypto mock.
globalThis.self = { postMessage: (value) => parentPort.postMessage(value) };
await import('../../../source/scripts/privacyProver/sentryWorker.ts');
parentPort.once('message', (data) => {
  parentPort.postMessage({ type: 'started' });
  void self.onmessage({ data });
});
parentPort.postMessage({ type: 'ready' });
