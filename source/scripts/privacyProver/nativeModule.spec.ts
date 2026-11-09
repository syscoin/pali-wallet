jest.mock(
  'expo-modules-core',
  () => ({ requireNativeModule: jest.fn(() => ({})) }),
  { virtual: true }
);
jest.mock('../../../apps/mobile/modules/pali-private-prover/runner', () => ({
  runSentryJob: jest.fn(),
}));

// Keep React Native's ambient globals out of the extension TypeScript project,
// while executing the actual native wrapper through the mocked host at runtime.
const { runNativeSentryCrypto } = jest.requireActual(
  '../../../apps/mobile/modules/pali-private-prover/index'
);

import {
  NATIVE_EXECUTION_CODES,
  nativeExecutionError,
  readNativeExecutionCode,
} from './nativeExecutionDiagnostic';

const run = jest.requireMock(
  '../../../apps/mobile/modules/pali-private-prover/runner'
).runSentryJob as jest.Mock;
beforeEach(() => run.mockReset());

it.each(NATIVE_EXECUTION_CODES)(
  'keeps public Sentry refusal and only its internal %s category',
  async (code) => {
    run.mockRejectedValue(
      nativeExecutionError('privacy_proof_failed', {
        nativeExecutionCode: code,
      })
    );
    const error = await runNativeSentryCrypto(
      { type: 'validateVote', request: {} },
      () => undefined
    ).catch((failure) => failure);
    expect(error.message).toBe('SENTRY_EXECUTION_FAILED');
    expect(readNativeExecutionCode(error)).toBe(code);
    expect(error).not.toHaveProperty('code');
    expect(error).not.toHaveProperty('cause');
  }
);

it('drops unknown native properties and getters at the public Sentry wrapper', async () => {
  const getter = jest.fn(() => {
    throw Error('private input');
  });
  run.mockRejectedValue(
    Object.defineProperty(Error('private input'), 'nativeExecutionCode', {
      get: getter,
    })
  );
  const error = await runNativeSentryCrypto(
    { type: 'validateVote', request: {} },
    () => undefined
  ).catch((failure) => failure);
  expect(error.message).toBe('SENTRY_EXECUTION_FAILED');
  expect(readNativeExecutionCode(error)).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.stringify(error)).not.toContain('private');
});

it('preserves the original authority check after a diagnosed execution failure', async () => {
  let current = true;
  run.mockImplementation(async () => {
    current = false;
    throw nativeExecutionError('privacy_proof_failed', {
      nativeExecutionCode: 'job-timeout',
    });
  });
  await expect(
    runNativeSentryCrypto({ type: 'validateVote', request: {} }, () => {
      if (!current) throw Error('RETIRED_OWNER');
    })
  ).rejects.toThrow('RETIRED_OWNER');
});
