import { parentPort, workerData } from 'node:worker_threads';

// Fixed test transport around the exact production Worker entry; no crypto mock.
globalThis.self = {
  postMessage: (value) => {
    // A test-only publication boundary makes termination independent of whether
    // the parent processes SDK-entry messages before real SHAKE work completes.
    if (value.type === 'success' && workerData?.publicationGate instanceof SharedArrayBuffer) {
      parentPort.postMessage({ type: 'publication-held' });
      Atomics.wait(new Int32Array(workerData.publicationGate), 0, 0);
    }
    parentPort.postMessage(value);
  },
};
await import('../../../source/scripts/privacyProver/sentryWorker.ts');
parentPort.once('message', (data) => {
  parentPort.postMessage({ type: 'started' });
  void self.onmessage({ data });
});
parentPort.postMessage({ type: 'ready' });
