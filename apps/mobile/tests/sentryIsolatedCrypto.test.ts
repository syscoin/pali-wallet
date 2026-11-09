import assert from 'node:assert/strict';
import { once } from 'node:events';
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
          if (value.type !== 'success')
            throw new Error('SENTRY_EXECUTION_FAILED');
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
      await qualifyNativeSentryIsolated(new AbortController().signal, executor),
      executor
    );
    assert(
      ticks > 10,
      'caller event loop remains live while the actual SHAKE work executes'
    );
  } finally {
    clearInterval(heartbeat);
  }
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

test('termination drains an actual active SHAKE worker without releasing its result', async () => {
  const worker = new Worker(
    new URL('./sentryCryptoWorkerThread.mjs', import.meta.url)
  );
  try {
    assert.deepEqual((await once(worker, 'message'))[0], { type: 'ready' });
    const started = once(worker, 'message');
    worker.postMessage({
      version: 1,
      kind: 'sentry',
      id: ID,
      job: {
        type: 'import',
        role: 'operator',
        scheme: 'slh-dsa-shake-128s',
        secretKey: SECRET,
      },
    });
    assert.deepEqual((await started)[0], { type: 'started' });
    let terminal = false;
    worker.on('message', () => {
      terminal = true;
    });
    await worker.terminate();
    assert.equal(terminal, false);
  } finally {
    await worker.terminate();
  }
});
