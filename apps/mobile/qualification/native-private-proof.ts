import fixture from '../../../source/utils/privacy/prover.fixture.json';
import {
  privacyPublicSignals,
  verifyPrivacyProof,
} from '../../../source/utils/privacy/proverCore';
import { PRIVACY_PROVING_KEY_SHA256 } from '../../../source/utils/privacy/proverArtifacts';
import type {
  IPrivacyProofOptions,
  IPrivacyProofProgress,
  IPrivacyProofResult,
} from '../../../source/utils/privacy/proverTypes';
import { runNativePrivacyProof } from '../modules/pali-private-prover';
import { assertSynchronousEvmFeeGuard } from '../../../source/shared/evmFeeGuard';
import {
  PRIVATE_PROOF_CASES,
  type PrivateProofResult,
} from './private-proof-contract.ts';

/** A public synthetic vector only. This caller never opens wallet storage. */
function verifyResult(result: IPrivacyProofResult) {
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
}

export async function qualifyNativePrivateProof(
  options: IPrivacyProofOptions
): Promise<PrivateProofResult> {
  const assertCurrent = () =>
    assertSynchronousEvmFeeGuard(options.assertCurrent);
  const cases: PrivateProofResult['cases'][number][] = [];
  for (const name of PRIVATE_PROOF_CASES) {
    assertCurrent();
    const started = Date.now();
    const stages = new Set<IPrivacyProofProgress['stage']>();
    const owner = new AbortController();
    let requestedCancellation = false;
    const externalAbort = () => owner.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', externalAbort, { once: true });
    if (options.signal?.aborted) externalAbort();
    try {
      let result: IPrivacyProofResult;
      try {
        result = await runNativePrivacyProof(
          {
            ...fixture.input,
            pathElements: [...fixture.input.pathElements],
            pathIndices: [...fixture.input.pathIndices],
          },
          {
            assertCurrent,
            signal: owner.signal,
            onProgress(progress) {
              stages.add(progress.stage);
              options.onProgress?.(progress);
              if (
                name === 'cancel-while-proving' &&
                progress.stage === 'proving'
              ) {
                requestedCancellation = true;
                owner.abort();
              }
            },
          }
        );
      } catch (error) {
        assertCurrent();
        if (
          !requestedCancellation ||
          options.signal?.aborted ||
          !(error instanceof Error) ||
          error.message !== 'privacy_proof_cancelled'
        )
          throw error;
        cases.push({
          name,
          outcome: 'cancelled',
          durationMs: Date.now() - started,
          stages: [...stages],
          rejectedPublicSignalMutations: 0,
        });
        continue;
      }
      assertCurrent();
      if (name === 'cancel-while-proving')
        throw new Error('PRIVATE_PROOF_CANCELLATION_NOT_OBSERVED');
      verifyResult(result);
      cases.push({
        name,
        outcome: 'verified',
        durationMs: Date.now() - started,
        stages: [...stages],
        rejectedPublicSignalMutations: 6,
      });
    } finally {
      options.signal?.removeEventListener('abort', externalAbort);
      owner.abort();
    }
  }
  assertCurrent();
  return Object.freeze({
    version: 1,
    provingKeySha256: PRIVACY_PROVING_KEY_SHA256,
    cases,
  });
}
