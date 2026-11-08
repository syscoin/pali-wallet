import { webcrypto } from 'crypto';

import { runProof } from '../../../apps/mobile/modules/pali-private-prover/runner';
import fixture from '../../utils/privacy/prover.fixture.json';
import { encodePrivacyProof } from '../../utils/privacy/proverCore';

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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const options = () => ({ assertCurrent: jest.fn() });
function setup() {
  const pending = deferred<string>();
  const disposed = deferred<void>();
  const context = {
    run: jest.fn<Promise<string>, [string, string]>(() => pending.promise),
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
  const task = runProof(host.native, structuredClone(fixture.input), options());
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
