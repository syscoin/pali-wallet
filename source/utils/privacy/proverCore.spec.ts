import fixture from './prover.fixture.json';
import {
  encodePrivacyProof,
  privacyPublicSignals,
  validatePrivacyProofInput,
  verifyPrivacyProof,
} from './proverCore';

it('independently verifies the canonical full synthetic Groth16 proof and public input order', () => {
  expect(privacyPublicSignals(fixture.input)).toEqual(fixture.publicSignals);
  expect(verifyPrivacyProof(fixture.proof, fixture.publicSignals)).toBe(true);
  expect(
    encodePrivacyProof(fixture.proof, fixture.publicSignals).proof
  ).toMatch(/^0x[0-9a-f]{512}$/);
});
it.each([0, 1, 2, 3, 4, 5])('rejects a change to public signal %s', (i) => {
  const values = [...fixture.publicSignals];
  values[i] = (BigInt(values[i]) + BigInt(1)).toString();
  expect(verifyPrivacyProof(fixture.proof, values)).toBe(false);
});
it.each(['pi_a', 'pi_c'])(
  'rejects malformed %s without exposing inputs',
  (part) => {
    const proof = JSON.parse(JSON.stringify(fixture.proof));
    proof[part][0] = '-1';
    expect(verifyPrivacyProof(proof, fixture.publicSignals)).toBe(false);
  }
);
it('rejects a modified G2 point', () => {
  const proof = JSON.parse(JSON.stringify(fixture.proof));
  proof.pi_b[0][0] = (BigInt(proof.pi_b[0][0]) + BigInt(1)).toString();
  expect(verifyPrivacyProof(proof, fixture.publicSignals)).toBe(false);
});
it.each([
  { secret: '-1' },
  { nullifier: (BigInt(1) << BigInt(248)).toString() },
  { fee: '01' },
  { recipient: 'not an address' },
  { root: '0x00' },
  { pathElements: [] },
  { pathIndices: Array(20).fill(2) },
])('rejects malformed witness inputs %#', (change) => {
  expect(() =>
    validatePrivacyProofInput({ ...fixture.input, ...change })
  ).toThrow(/^privacy_proof_invalid_input$/);
});
it('projects only approved fields', () => {
  expect(
    validatePrivacyProofInput({ ...fixture.input, extra: 'discard' } as any)
  ).not.toHaveProperty('extra');
});
