import fixture from '../../../source/utils/privacy/prover.fixture.json';
import {
  privacyPublicSignals,
  verifyPrivacyProof,
} from '../../../source/utils/privacy/proverCore';
import { PRIVACY_PROVING_KEY_SHA256 } from '../../../source/utils/privacy/proverArtifacts';
import type {
  IPrivacyProofOptions,
  IPrivacyProofProgress,
} from '../../../source/utils/privacy/proverTypes';
import { runNativePrivacyProof } from '../modules/pali-private-prover';
import { assertSynchronousEvmFeeGuard } from '../../../source/shared/evmFeeApproval';

/** A public synthetic vector only. This caller never opens wallet storage. */
export async function qualifyNativePrivateProof(options: IPrivacyProofOptions) {
  const stages = new Set<IPrivacyProofProgress['stage']>();
  const assertCurrent = () =>
    assertSynchronousEvmFeeGuard(options.assertCurrent);
  assertCurrent();
  const started = Date.now();
  const result = await runNativePrivacyProof(
    {
      ...fixture.input,
      pathElements: [...fixture.input.pathElements],
      pathIndices: [...fixture.input.pathIndices],
    },
    {
      ...options,
      onProgress(progress) {
        stages.add(progress.stage);
        options.onProgress?.(progress);
      },
    }
  );
  assertCurrent();
  const expected = privacyPublicSignals(fixture.input);
  if (
    result.publicSignals.length !== 6 ||
    result.publicSignals.some((value, index) => value !== expected[index]) ||
    !/^0x[0-9a-f]{512}$/i.test(result.proof)
  )
    throw new Error('PRIVATE_PROOF_RESULT_INVALID');
  const words = result.proof
    .slice(2)
    .match(/.{64}/g)!
    .map((word) => BigInt(`0x${word}`).toString());
  const proof = {
    pi_a: [words[0]!, words[1]!, '1'],
    pi_b: [
      [words[3]!, words[2]!],
      [words[5]!, words[4]!],
      ['1', '0'],
    ],
    pi_c: [words[6]!, words[7]!, '1'],
  };
  if (!verifyPrivacyProof(proof, expected))
    throw new Error('PRIVATE_PROOF_RESULT_INVALID');
  for (let index = 0; index < 6; index++) {
    const changed = [...expected];
    changed[index] = (BigInt(changed[index]!) + BigInt(1)).toString();
    if (verifyPrivacyProof(proof, changed))
      throw new Error('PRIVATE_PROOF_MUTATION_ACCEPTED');
  }
  assertCurrent();
  return Object.freeze({
    version: 1,
    proofVerified: true,
    rejectedPublicSignalMutations: 6,
    durationMs: Date.now() - started,
    stages: [...stages],
    provingKeySha256: PRIVACY_PROVING_KEY_SHA256,
  });
}
