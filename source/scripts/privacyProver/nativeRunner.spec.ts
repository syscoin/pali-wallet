import { webcrypto } from 'crypto';

import {
  runProof,
  runSentryJob,
} from '../../../apps/mobile/modules/pali-private-prover/runner';
import { NativePrivateWithdrawal } from '../../../apps/mobile/src/custody/privateWithdrawal';
import fixture from '../../utils/privacy/prover.fixture.json';
import { encodePrivacyProof } from '../../utils/privacy/proverCore';

import { readNativeExecutionCode } from './nativeExecutionDiagnostic';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const options = () => ({ assertCurrent: jest.fn() });
function setup() {
  const pending = deferred<string>();
  const disposed = deferred<void>();
  const context = {
    run: jest.fn<Promise<string>, [string, string]>(() => pending.promise),
    runSentry: jest.fn<Promise<string>, [string, string]>(
      () => pending.promise
    ),
    close: jest.fn(),
    dispose: jest.fn(() => disposed.promise),
    addListener: jest.fn<
      { remove(): void },
      ['progress', (json: string) => void]
    >(() => ({ remove: jest.fn() })),
  };
  return {
    native: { createHost: jest.fn(() => context) },
    context,
    pending,
    disposed,
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it('keeps global admission through acknowledged disposal after a valid proof', async () => {
  const host = setup();
  const onProgress = jest.fn();
  const task = runProof(host.native, structuredClone(fixture.input), {
    ...options(),
    onProgress,
  });
  const id = host.context.run.mock.calls[0][0];
  host.context.addListener.mock.calls[0][1](
    JSON.stringify({
      version: 1,
      id,
      type: 'progress',
      progress: { stage: 'proving' },
    })
  );
  expect(onProgress).toHaveBeenCalledWith({ stage: 'proving' });
  expect(host.context.close).not.toHaveBeenCalled();
  host.pending.resolve(
    JSON.stringify({
      version: 1,
      id,
      type: 'success',
      result: encodePrivacyProof(fixture.proof, fixture.publicSignals),
    })
  );
  await flush();
  expect(host.context.dispose).toHaveBeenCalledTimes(1);
  await expect(
    runProof(host.native, structuredClone(fixture.input), options())
  ).rejects.toThrow('privacy_proof_busy');
  host.disposed.resolve();
  await expect(task).resolves.toEqual(
    encodePrivacyProof(fixture.proof, fixture.publicSignals)
  );
});

it('revokes synchronously on abort and still awaits disposal when native run never settles', async () => {
  const host = setup();
  const abort = new AbortController();
  const task = runProof(host.native, structuredClone(fixture.input), {
    ...options(),
    signal: abort.signal,
  });
  abort.abort();
  expect(host.context.close).toHaveBeenCalledTimes(1);
  await flush();
  expect(host.context.dispose).toHaveBeenCalledTimes(1);
  host.disposed.resolve();
  await expect(task).rejects.toThrow('privacy_proof_cancelled');
});

it('refuses already cancelled work before creating a native resource', async () => {
  const host = setup();
  const abort = new AbortController();
  abort.abort();
  await expect(
    runProof(host.native, structuredClone(fixture.input), {
      ...options(),
      signal: abort.signal,
    })
  ).rejects.toThrow('privacy_proof_cancelled');
  expect(host.native.createHost).not.toHaveBeenCalled();
});

it('revokes after a wallet scope change without waiting for a worker response', async () => {
  jest.useFakeTimers();
  const host = setup();
  const scope = options();
  const task = runProof(host.native, structuredClone(fixture.input), scope);
  scope.assertCurrent.mockImplementation(() => {
    throw new Error('changed');
  });
  jest.advanceTimersByTime(250);
  expect(host.context.close).toHaveBeenCalledTimes(1);
  await flush();
  host.disposed.resolve();
  await expect(task).rejects.toThrow('privacy_proof_cancelled');
  jest.useRealTimers();
});

it('checks authority again after awaited document retirement', async () => {
  const host = setup();
  const scope = options();
  const task = runProof(host.native, structuredClone(fixture.input), scope);
  const id = host.context.run.mock.calls[0][0];
  host.pending.resolve(
    JSON.stringify({
      version: 1,
      id,
      type: 'success',
      result: encodePrivacyProof(fixture.proof, fixture.publicSignals),
    })
  );
  await flush();
  scope.assertCurrent.mockImplementation(() => {
    throw new Error('changed');
  });
  host.disposed.resolve();
  await expect(task).rejects.toThrow('changed');
});

it.each([
  () => Promise.resolve(),
  () => Promise.reject(new Error('private')),
  () => true,
])(
  'rejects asynchronous and non-void guards before creating a native host',
  async (assertCurrent) => {
    const host = setup();
    await expect(
      runProof(host.native, structuredClone(fixture.input), { assertCurrent })
    ).rejects.toThrow('guard must be synchronous');
    expect(host.native.createHost).not.toHaveBeenCalled();
    expect(host.context.run).not.toHaveBeenCalled();
  }
);

it.each(['poll', 'signal', 'result'])(
  'preserves verification pending from %s',
  async (phase) => {
    jest.useFakeTimers();
    try {
      const host = setup();
      const scope = options();
      const abort = new AbortController();
      const task = runProof(host.native, structuredClone(fixture.input), {
        ...scope,
        signal: abort.signal,
      });
      const failure = new Error('privacy_verification_pending');
      if (phase === 'signal') abort.abort(failure);
      else {
        scope.assertCurrent.mockImplementation(() => {
          throw failure;
        });
        if (phase === 'poll') jest.advanceTimersByTime(250);
        else {
          const id = host.context.run.mock.calls[0][0];
          host.pending.resolve(
            JSON.stringify({
              version: 1,
              id,
              type: 'success',
              result: encodePrivacyProof(fixture.proof, fixture.publicSignals),
            })
          );
        }
      }
      await flush();
      host.disposed.resolve();
      await expect(task).rejects.toThrow('privacy_verification_pending');
    } finally {
      jest.useRealTimers();
    }
  }
);

it('rechecks the strict guard after an input getter invalidates its owner', async () => {
  const host = setup();
  let current = true;
  const value = structuredClone(fixture.input);
  Object.defineProperty(value, 'secret', {
    enumerable: true,
    get() {
      current = false;
      return fixture.input.secret;
    },
  });
  await expect(
    runProof(host.native, value, {
      assertCurrent() {
        if (!current) throw new Error('privacy_verification_pending');
      },
    })
  ).rejects.toThrow('privacy_verification_pending');
  expect(host.native.createHost).not.toHaveBeenCalled();
});

it.each(['malformed', 'handler'])(
  'preserves proof failure when %s progress is rejected',
  async (kind) => {
    const host = setup();
    const task = runProof(host.native, structuredClone(fixture.input), {
      ...options(),
      onProgress() {
        if (kind === 'handler') throw new Error('private');
      },
    });
    const id = host.context.run.mock.calls[0][0];
    host.context.addListener.mock.calls[0][1](
      JSON.stringify({
        version: 1,
        id,
        type: 'progress',
        progress: { stage: kind === 'malformed' ? 'private' : 'proving' },
      })
    );
    await flush();
    host.disposed.resolve();
    await expect(task).rejects.toThrow('privacy_proof_failed');
  }
);

it('drains cancelled model preparation through final native document disposal', async () => {
  const host = setup();
  const abort = new AbortController();
  const close = jest.fn(async () => undefined);
  const model = new NativePrivateWithdrawal(
    {
      assertCurrent() {
        return undefined;
      },
      canSign: true,
      restored: false,
      noteId: 'owned-note',
      poolId: 'eth-1',
      createWithdrawals() {
        return {
          close: () => abort.abort(),
          cancelPreparation: () => abort.abort(),
          async discardWithdrawal() {
            return undefined;
          },
          async prepareWithdrawal() {
            await runProof(host.native, structuredClone(fixture.input), {
              ...options(),
              signal: abort.signal,
            });
            throw new Error('cancelled proof must not produce a review');
          },
          async submitWithdrawal() {
            throw new Error('unexpected submission');
          },
          async getRelayers() {
            return [];
          },
          async statusByNote() {
            return { noteId: 'owned-note', phase: 'none' };
          },
        };
      },
      async readNoteStatus() {
        return { phase: 'waiting' };
      },
      async reviewRestored() {
        return undefined;
      },
      close,
    },
    new AbortController().signal
  );
  const preparing = model.prepare({ recipient: 'recipient', mode: 'direct' });
  expect(host.context.run).toHaveBeenCalledTimes(1);
  let publications = 0;
  model.subscribe(() => publications++);
  const disposing = model.dispose();
  let disposed = false;
  void disposing.then(() => {
    disposed = true;
  });
  expect(host.context.close).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  await flush();
  expect(host.context.dispose).toHaveBeenCalledTimes(1);
  expect(disposed).toBe(false);
  await expect(
    runProof(host.native, structuredClone(fixture.input), options())
  ).rejects.toThrow('privacy_proof_busy');
  host.disposed.resolve();
  await Promise.all([preparing, disposing]);
  expect(disposed).toBe(true);
  expect(publications).toBe(0);
  expect(model.getSnapshot().review).toBeNull();
});

it('shares global admission and acknowledged disposal between SDK and proof jobs', async () => {
  const host = setup();
  const job = {
    type: 'import' as const,
    role: 'voting' as const,
    scheme: 'secp256k1' as const,
    secretKey: '02'.padStart(64, '0'),
  };
  const task = runSentryJob(host.native, job, options());
  const [id, json] = host.context.runSentry.mock.calls[0];
  expect(host.context.run).not.toHaveBeenCalled();
  expect(JSON.parse(json)).toEqual({ version: 1, kind: 'sentry', job });
  host.context.addListener.mock.calls[0][1](
    JSON.stringify({ version: 1, kind: 'sentry', id, type: 'sdk-start' })
  );
  expect(host.context.close).not.toHaveBeenCalled();
  const key = {
    role: job.role,
    scheme: job.scheme,
    secretKey: job.secretKey,
    publicKey:
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  };
  host.pending.resolve(
    JSON.stringify({
      version: 1,
      kind: 'sentry',
      id,
      type: 'success',
      result: key,
    })
  );
  await flush();
  await expect(
    runProof(host.native, structuredClone(fixture.input), options())
  ).rejects.toThrow('privacy_proof_busy');
  host.disposed.resolve();
  await expect(task).resolves.toEqual(key);
});

it('refuses a proof-domain result for a Sentry job and drains retirement', async () => {
  const host = setup();
  const task = runSentryJob(
    host.native,
    { type: 'validateVote', request: {} },
    options()
  );
  const id = host.context.runSentry.mock.calls[0][0];
  host.pending.resolve(
    JSON.stringify({
      version: 1,
      id,
      type: 'success',
      result: encodePrivacyProof(fixture.proof, fixture.publicSignals),
    })
  );
  await flush();
  host.disposed.resolve();
  await expect(task).rejects.toThrow('privacy_proof_failed');
});

it.each([
  ['ERR_PALI_NATIVE_READINESS_TIMEOUT', 'readiness-timeout'],
  ['ERR_PALI_NATIVE_JOB_TIMEOUT', 'job-timeout'],
  ['ERR_PALI_NATIVE_SDK_JOB_TIMEOUT', 'sdk-job-timeout'],
])(
  'retains %s through a failed native execution and acknowledged disposal',
  async (code, expected) => {
    const host = setup();
    const task = runSentryJob(
      host.native,
      { type: 'validateVote', request: {} },
      options()
    );
    const outcome = task.catch((error) => error);
    host.pending.reject(Object.assign(Error('private native input'), { code }));
    await flush();
    await flush();
    expect(host.context.dispose).toHaveBeenCalledTimes(1);
    await expect(
      runProof(host.native, structuredClone(fixture.input), options())
    ).rejects.toThrow('privacy_proof_busy');
    host.disposed.resolve();
    const error = await outcome;
    expect(error.message).toBe('privacy_proof_failed');
    expect(readNativeExecutionCode(error)).toBe(expected);
    expect(error).not.toHaveProperty('code');
    expect(error).not.toHaveProperty('cause');
  }
);

it('preserves asynchronous native verification-pending rejection through disposal', async () => {
  const host = setup();
  const task = runProof(host.native, structuredClone(fixture.input), options());
  const outcome = task.catch((error) => error);
  host.pending.reject(new Error('privacy_verification_pending'));
  await flush();
  await flush();
  expect(host.context.dispose).toHaveBeenCalledTimes(1);
  host.disposed.resolve();
  const error = await outcome;
  expect(error.message).toBe('privacy_verification_pending');
  expect(readNativeExecutionCode(error)).toBeUndefined();
});

it('keeps unknown native code getters inert and refuses the result', async () => {
  const host = setup(),
    getter = jest.fn(() => {
      throw Error('private getter');
    });
  const task = runSentryJob(
    host.native,
    { type: 'validateVote', request: {} },
    options()
  );
  const outcome = task.catch((error) => error);
  host.pending.reject(
    Object.defineProperty(Error('private input'), 'code', { get: getter })
  );
  await flush();
  await flush();
  host.disposed.resolve();
  const error = await outcome;
  expect(error.message).toBe('privacy_proof_failed');
  expect(readNativeExecutionCode(error)).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
});

it.each([false, true])(
  'classifies the unchanged JS watchdog using only its owned observed SDK entry (%s)',
  async (observed) => {
    jest.useFakeTimers();
    const host = setup();
    try {
      const task = runSentryJob(
        host.native,
        { type: 'validateVote', request: {} },
        options()
      );
      const outcome = task.catch((error) => error);
      const id = host.context.runSentry.mock.calls[0][0];
      const listener = host.context.addListener.mock.calls[0][1];
      const entry = JSON.stringify({
        version: 1,
        kind: 'sentry',
        id,
        type: 'sdk-start',
      });
      jest.advanceTimersByTime(119000);
      if (observed) listener(entry);
      expect(host.context.close).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      // A late native event cannot upgrade a timeout that already revoked its owner.
      if (!observed) listener(entry);
      await flush();
      expect(host.context.close).toHaveBeenCalled();
      await expect(
        runProof(host.native, structuredClone(fixture.input), options())
      ).rejects.toThrow('privacy_proof_busy');
      host.disposed.resolve();
      const error = await outcome;
      expect(error.message).toBe('privacy_proof_cancelled');
      expect(readNativeExecutionCode(error)).toBe(
        observed ? 'sdk-job-timeout' : 'job-timeout'
      );
    } finally {
      jest.useRealTimers();
    }
  }
);

it.each(['wrong-id', 'wrong-kind', 'extra', 'duplicate', 'proof-domain'])(
  'refuses %s SDK-entry evidence without classifying it or publishing progress',
  async (fault) => {
    const host = setup();
    const task =
      fault === 'proof-domain'
        ? runProof(host.native, structuredClone(fixture.input), options())
        : runSentryJob(
            host.native,
            { type: 'validateVote', request: {} },
            options()
          );
    const outcome = task.catch((error) => error);
    const id = (
      fault === 'proof-domain' ? host.context.run : host.context.runSentry
    ).mock.calls[0][0];
    const listener = host.context.addListener.mock.calls[0][1];
    const entry = { version: 1, kind: 'sentry', id, type: 'sdk-start' };
    if (fault === 'duplicate') listener(JSON.stringify(entry));
    listener(
      JSON.stringify(
        fault === 'wrong-id'
          ? { ...entry, id: '00000000-0000-4000-8000-000000000002' }
          : fault === 'wrong-kind'
          ? { ...entry, kind: 'proof' }
          : fault === 'extra'
          ? { ...entry, secret: 'private marker' }
          : entry
      )
    );
    await flush();
    expect(host.context.close).toHaveBeenCalled();
    host.disposed.resolve();
    const error = await outcome;
    expect(error.message).toBe('privacy_proof_failed');
    expect(readNativeExecutionCode(error)).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('private marker');
  }
);

it('an SDK-entry marker on the terminal channel is never a signature result', async () => {
  const host = setup();
  const task = runSentryJob(
    host.native,
    { type: 'validateVote', request: {} },
    options()
  );
  const outcome = task.catch((error) => error);
  const id = host.context.runSentry.mock.calls[0][0];
  host.pending.resolve(
    JSON.stringify({ version: 1, kind: 'sentry', id, type: 'sdk-start' })
  );
  await flush();
  host.disposed.resolve();
  const error = await outcome;
  expect(error.message).toBe('privacy_proof_failed');
  expect(readNativeExecutionCode(error)).toBeUndefined();
});

it('a retired listener cannot classify a successor SDK job', async () => {
  jest.useFakeTimers();
  try {
    const first = setup();
    const abort = new AbortController();
    const cancelled = runSentryJob(
      first.native,
      { type: 'validateVote', request: {} },
      { ...options(), signal: abort.signal }
    ).catch((error) => error);
    const oldId = first.context.runSentry.mock.calls[0][0];
    const oldListener = first.context.addListener.mock.calls[0][1];
    abort.abort();
    await flush();
    first.disposed.resolve();
    expect((await cancelled).message).toBe('privacy_proof_cancelled');
    const successor = setup();
    const outcome = runSentryJob(
      successor.native,
      { type: 'validateVote', request: {} },
      options()
    ).catch((error) => error);
    oldListener(
      JSON.stringify({
        version: 1,
        kind: 'sentry',
        id: oldId,
        type: 'sdk-start',
      })
    );
    expect(successor.context.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120000);
    await flush();
    successor.disposed.resolve();
    expect(readNativeExecutionCode(await outcome)).toBe('job-timeout');
  } finally {
    jest.useRealTimers();
  }
});

it('retains disposal timeout evidence while poisoning its isolated admission', async () => {
  let isolated!: typeof import('../../../apps/mobile/modules/pali-private-prover/runner');
  jest.isolateModules(() => {
    isolated = jest.requireActual(
      '../../../apps/mobile/modules/pali-private-prover/runner'
    );
  });
  const host = setup();
  host.context.dispose.mockImplementation(async () => {
    throw Object.assign(Error('private input'), {
      code: 'ERR_PALI_NATIVE_DISPOSAL_TIMEOUT',
    });
  });
  const outcome = isolated
    .runProof(host.native, structuredClone(fixture.input), options())
    .catch((error) => error);
  host.pending.resolve('malformed private native error');
  const error = await outcome;
  expect(error.message).toBe('privacy_proof_unavailable');
  expect(readNativeExecutionCode(error)).toBe('disposal-timeout');
  await expect(
    isolated.runProof(host.native, structuredClone(fixture.input), options())
  ).rejects.toThrow('privacy_proof_unavailable');
});

it('poisons subsequent admission when document retirement cannot be established', async () => {
  const host = setup();
  host.context.dispose.mockImplementation(async () => {
    throw new Error('private');
  });
  const task = runProof(host.native, structuredClone(fixture.input), options());
  host.pending.resolve('malformed private native error');
  await expect(task).rejects.toThrow('privacy_proof_unavailable');
  await expect(
    runProof(host.native, structuredClone(fixture.input), options())
  ).rejects.toThrow('privacy_proof_unavailable');
});
