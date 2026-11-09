import assert from 'node:assert/strict';
import { on, once } from 'node:events';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { URL } from 'node:url';
import { qualifyNativeSentryIsolated } from '../qualification/native-sentry-isolated.ts';
import { createSentryCryptoExecutor } from '../src/crypto/sentryCryptoExecutor.ts';
import {
  captureNativeSentryInput,
  readNativeSentryMessage,
  NATIVE_SENTRY_MESSAGE_LIMIT,
} from '../../../source/scripts/privacyProver/nativeSentryProtocol.ts';
import type {
  SentryCryptoJob,
  SentryCryptoResult,
} from '../../../source/wallet/sentryCryptoJobs.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const SECRET = '37'.repeat(48) + 'df7468cb62f0ff4e6ec27cbe18019216';
const PUBLIC = '37'.repeat(16) + 'df7468cb62f0ff4e6ec27cbe18019216';
async function execute<T extends SentryCryptoResult>(
  job: SentryCryptoJob
): Promise<T> {
  const worker = new Worker(
    new URL('./sentryCryptoWorkerThread.mjs', import.meta.url)
  );
  try {
    assert.deepEqual((await once(worker, 'message'))[0], { type: 'ready' });
    let sdkStarted = false;
    const result = new Promise<T>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', (message) => {
        if (message.type === 'started') return;
        try {
          const value = readNativeSentryMessage(
            JSON.stringify(message),
            ID,
            job
          );
          if (value.type === 'sdk-start') {
            assert.equal(sdkStarted, false);
            sdkStarted = true;
            return;
          }
          if (value.type !== 'success')
            throw new Error('SENTRY_EXECUTION_FAILED');
          assert.equal(sdkStarted, true);
          resolve(value.result as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    worker.postMessage({ version: 1, kind: 'sentry', id: ID, job });
    return await result;
  } finally {
    await worker.terminate();
  }
}

test('exact production SDK worker performs real SHAKE key validation, service and management signatures off the caller thread', async () => {
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 5);
  const observed: string[] = [];
  try {
    const run: import('../../../source/wallet/sentryCryptoJobs.ts').RunSentryCrypto =
      async (job, check) => {
        check();
        const result = await execute(job);
        check();
        return result as never;
      };
    const executor = createSentryCryptoExecutor(async () => {
      throw new Error('PQ job reached renderer crypto');
    }, run);
    assert.equal(
      await qualifyNativeSentryIsolated(new AbortController().signal, executor,
        (step, phase) => observed.push(`${step}:${phase}`)),
      executor
    );
    assert.deepEqual(observed, ['operator-import', 'service-sign', 'service-verify', 'owner-sign', 'owner-verify']
      .flatMap(step => [`${step}:started`, `${step}:completed`]));
    assert(
      ticks > 10,
      'caller event loop remains live while the actual SHAKE work executes'
    );
  } finally {
    clearInterval(heartbeat);
  }
});

test('isolated qualification requires its observer before starting native work', async () => {
  let calls = 0;
  const executeNothing = async () => { calls++; throw new Error('must not execute'); };
  await assert.rejects(
    // @ts-expect-error Deliberately exercise a missing required observer at runtime.
    qualifyNativeSentryIsolated(new AbortController().signal, executeNothing),
    /SENTRY_ISOLATED_DIAGNOSTIC_REQUIRED/
  );
  assert.equal(calls, 0);
});

test('a failed isolated call leaves the exact started step without a completion label', async () => {
  const observed: string[] = [];
  await assert.rejects(qualifyNativeSentryIsolated(new AbortController().signal,
    async () => { throw new Error('SENTRY_EXECUTION_FAILED'); },
    (step, phase) => observed.push(`${step}:${phase}`)), /SENTRY_EXECUTION_FAILED/);
  assert.deepEqual(observed, ['operator-import:started']);
});

test('isolated protocol refuses untagged proof payloads, arbitrary jobs, extra authority fields and wrong-domain results', () => {
  const job: SentryCryptoJob = {
    type: 'import',
    role: 'operator',
    scheme: 'slh-dsa-shake-128s',
    secretKey: SECRET,
  };
  for (const value of [
    { version: 1, job },
    {
      version: 1,
      kind: 'sentry',
      job: { ...job, type: 'eval', script: 'private' },
    },
    {
      version: 1,
      kind: 'sentry',
      job: { ...job, workerUrl: 'https://outside.test' },
    },
    { version: true, kind: 'sentry', job },
    { version: 1, kind: 'proof', job },
  ])
    assert.throws(
      () => captureNativeSentryInput(JSON.stringify(value)),
      /SENTRY_EXECUTION_FAILED/
    );
  assert.throws(
    () => captureNativeSentryInput(' '.repeat(NATIVE_SENTRY_MESSAGE_LIMIT + 1)),
    /SENTRY_EXECUTION_FAILED/
  );
  for (const value of [
    { version: 1, id: ID, type: 'success', result: {} },
    { version: 1, kind: 'sentry', id: ID, type: 'error', error: SECRET },
    {
      version: 1,
      kind: 'sentry',
      id: ID,
      type: 'success',
      result: {
        role: 'owner',
        scheme: 'slh-dsa-shake-128s',
        secretKey: SECRET,
        publicKey: PUBLIC,
      },
    },
  ])
    assert.throws(
      () => readNativeSentryMessage(JSON.stringify(value), ID, job),
      /SENTRY_EXECUTION_FAILED/
    );
});

test('worker errors redact an inconsistent complete raw SHAKE key', async () => {
  await assert.rejects(
    execute({
      type: 'import',
      role: 'operator',
      scheme: 'slh-dsa-shake-128s',
      secretKey: SECRET.slice(0, -2) + '00',
    }),
    { message: 'SENTRY_EXECUTION_FAILED' }
  );
});

test('termination drains a real SHAKE worker before its held result is published', async () => {
  // First prove that the held result is real and publishable, then terminate
  // the same actual SDK job at that boundary. This does not claim mid-hash cancellation.
  for (const release of [true, false]) {
    const publicationGate = new SharedArrayBuffer(4);
    const worker = new Worker(
      new URL('./sentryCryptoWorkerThread.mjs', import.meta.url),
      { workerData: { publicationGate } }
    );
    const job: SentryCryptoJob = {
      type: 'import',
      role: 'operator',
      scheme: 'slh-dsa-shake-128s',
      secretKey: SECRET,
    };
    try {
      assert.deepEqual((await once(worker, 'message'))[0], { type: 'ready' });
      const messages = on(worker, 'message', { close: ['exit'] });
      worker.postMessage({ version: 1, kind: 'sentry', id: ID, job });
      let sdkStarted = false, held = false;
      for await (const [message] of messages) {
        if (message.type === 'started') continue;
        if (message.type === 'publication-held') {
          held = true;
          break;
        }
        const value = readNativeSentryMessage(JSON.stringify(message), ID, job);
        assert.equal(value.type, 'sdk-start');
        assert.equal(sdkStarted, false);
        sdkStarted = true;
      }
      assert.equal(sdkStarted, true);
      assert.equal(held, true);
      if (release) {
        const delivered = once(worker, 'message');
        Atomics.store(new Int32Array(publicationGate), 0, 1);
        Atomics.notify(new Int32Array(publicationGate), 0);
        const value = readNativeSentryMessage(JSON.stringify((await delivered)[0]), ID, job);
        assert(value.type === 'success');
        assert.deepEqual(value.result, { role: 'operator', scheme: 'slh-dsa-shake-128s', secretKey: SECRET, publicKey: PUBLIC });
      } else {
        const terminal: string[] = [];
        worker.on('message', (message) => {
          const value = readNativeSentryMessage(JSON.stringify(message), ID, job);
          if (value.type !== 'sdk-start') terminal.push(value.type);
        });
        await worker.terminate();
        assert.deepEqual(terminal, []);
      }
    } finally {
      await worker.terminate();
    }
  }
});
