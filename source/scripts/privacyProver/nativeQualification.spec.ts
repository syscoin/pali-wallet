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
    args[1].onProgress?.({ stage: 'proving' });
    return encodePrivacyProof(fixture.proof, fixture.publicSignals);
  });
  const assertCurrent = jest.fn();
  const report = await qualifyNativePrivateProof({ assertCurrent });
  expect(run.mock.calls[0][0]).toEqual(fixture.input);
  expect(report).toEqual({
    version: 1,
    proofVerified: true,
    rejectedPublicSignalMutations: 6,
    durationMs: expect.any(Number),
    stages: ['proving'],
    provingKeySha256:
      '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af',
  });
  expect(assertCurrent).toHaveBeenCalledTimes(3);
  expect(report).not.toHaveProperty('proof');
  expect(report).not.toHaveProperty('input');
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
