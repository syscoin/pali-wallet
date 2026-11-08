import fixture from '../../utils/privacy/prover.fixture.json';
import { encodePrivacyProof } from '../../utils/privacy/proverCore';

jest.mock('../../../apps/mobile/modules/pali-private-prover', () => ({
  runNativePrivacyProof: jest.fn(),
}));
// Load the native-only caller at runtime so React Native's ambient globals do
// not enter the extension TypeScript project through this mocked host test.
const { qualifyNativePrivateProof } = jest.requireActual(
  '../../../apps/mobile/qualification/native-private-proof'
);
const run = jest.requireMock('../../../apps/mobile/modules/pali-private-prover')
  .runNativePrivacyProof as jest.Mock;

beforeEach(() => run.mockReset());
it('calls the actual adapter port with only the fixed public fixture and verifies all six mutations', async () => {
  run.mockImplementation(async (...args) => {
    for (const stage of ['artifacts', 'witness', 'proving', 'verifying']) {
      args[1].onProgress?.({ stage });
      if (args[1].signal.aborted) throw new Error('privacy_proof_cancelled');
    }
    return encodePrivacyProof(fixture.proof, fixture.publicSignals);
  });
  const assertCurrent = jest.fn();
  const report = await qualifyNativePrivateProof({ assertCurrent });
  expect(run.mock.calls[0][0]).toEqual(fixture.input);
  expect(report).toEqual({
    version: 1,
    cases: [
      {
        name: 'proof-before-cancel',
        outcome: 'verified',
        rejectedPublicSignalMutations: 6,
        durationMs: expect.any(Number),
        stages: ['artifacts', 'witness', 'proving', 'verifying'],
      },
      {
        name: 'cancel-while-proving',
        outcome: 'cancelled',
        rejectedPublicSignalMutations: 0,
        durationMs: expect.any(Number),
        stages: ['artifacts', 'witness', 'proving'],
      },
      {
        name: 'proof-after-cancel',
        outcome: 'verified',
        rejectedPublicSignalMutations: 6,
        durationMs: expect.any(Number),
        stages: ['artifacts', 'witness', 'proving', 'verifying'],
      },
    ],
    provingKeySha256:
      '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',
  });
  expect(run).toHaveBeenCalledTimes(3);
  expect(assertCurrent).toHaveBeenCalled();
  expect(report).not.toHaveProperty('proof');
  expect(report).not.toHaveProperty('input');
});

it('awaits the cancelled proof disposal before admitting the final proof', async () => {
  let rejectCancellation!: (error: Error) => void;
  const cancelled = new Promise((_resolve, reject) => {
    rejectCancellation = reject;
  });
  run.mockImplementation(async (...args) => {
    args[1].onProgress?.({ stage: 'proving' });
    if (run.mock.calls.length === 2) return cancelled;
    return encodePrivacyProof(fixture.proof, fixture.publicSignals);
  });
  const task = qualifyNativePrivateProof({ assertCurrent: jest.fn() });
  await Promise.resolve();
  await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(2);
  rejectCancellation(new Error('privacy_proof_cancelled'));
  await task;
  expect(run).toHaveBeenCalledTimes(3);
});

it('refuses a successful result from the cancellation case', async () => {
  run.mockImplementation(async (...args) => {
    args[1].onProgress?.({ stage: 'proving' });
    return encodePrivacyProof(fixture.proof, fixture.publicSignals);
  });
  await expect(
    qualifyNativePrivateProof({ assertCurrent: jest.fn() })
  ).rejects.toThrow('PRIVATE_PROOF_CANCELLATION_NOT_OBSERVED');
});

it('rejects a structurally valid but false proof and a changed public signal', async () => {
  run.mockResolvedValue({
    proof: `0x${'00'.repeat(256)}`,
    publicSignals: fixture.publicSignals,
  });
  await expect(
    qualifyNativePrivateProof({ assertCurrent: jest.fn() })
  ).rejects.toThrow('PRIVATE_PROOF_RESULT_INVALID');
  const result = encodePrivacyProof(fixture.proof, fixture.publicSignals);
  run.mockResolvedValue({
    ...result,
    publicSignals: ['0', ...result.publicSignals.slice(1)],
  });
  await expect(
    qualifyNativePrivateProof({ assertCurrent: jest.fn() })
  ).rejects.toThrow('PRIVATE_PROOF_RESULT_INVALID');
});
