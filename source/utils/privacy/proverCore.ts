import { bn254 } from '@noble/curves/bn254';

import verificationKey from 'scripts/privacyProver/assets/verification-key.json';

import type { IPrivacyProofInput, IPrivacyProofResult } from './proverTypes';

const FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const BASE_FIELD = BigInt(
  '21888242871839275222246405745257275088696311157297823662689037894645226208583'
);
const NOTE_LIMIT = BigInt(1) << BigInt(248);
const WORD = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,76})$/;
const invalid = () => new Error('privacy_proof_invalid_input');

const decimal = (value: unknown, limit: bigint): string => {
  if (
    typeof value !== 'string' ||
    !DECIMAL.test(value) ||
    BigInt(value) >= limit
  )
    throw invalid();
  return value;
};
const word = (value: unknown): string => {
  if (typeof value !== 'string' || !WORD.test(value) || BigInt(value) >= FIELD)
    throw invalid();
  return BigInt(value).toString();
};
const address = (value: unknown): string => {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw invalid();
  return BigInt(value).toString();
};

/** Strict projection before untrusted input reaches the legacy witness runtime. */
export function validatePrivacyProofInput(value: IPrivacyProofInput) {
  if (
    !value ||
    !Array.isArray(value.pathElements) ||
    value.pathElements.length !== 20 ||
    !Array.isArray(value.pathIndices) ||
    value.pathIndices.length !== 20 ||
    Array.from(value.pathIndices).some((i) => i !== 0 && i !== 1)
  )
    throw invalid();
  return {
    root: word(value.root),
    nullifierHash: word(value.nullifierHash),
    recipient: address(value.recipient),
    relayer: address(value.relayer),
    fee: decimal(value.fee, FIELD),
    refund: decimal(value.refund, FIELD),
    nullifier: decimal(value.nullifier, NOTE_LIMIT),
    secret: decimal(value.secret, NOTE_LIMIT),
    pathElements: Array.from(value.pathElements, word),
    pathIndices: [...value.pathIndices],
  };
}

export function privacyPublicSignals(input: IPrivacyProofInput): string[] {
  const value = validatePrivacyProofInput(input);
  return [
    value.root,
    value.nullifierHash,
    value.recipient,
    value.relayer,
    value.fee,
    value.refund,
  ];
}

interface IProof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}
const coordinate = (value: unknown) => BigInt(decimal(value, BASE_FIELD));
const g1 = (value: string[]) => {
  if (!Array.isArray(value) || value.length !== 3 || value[2] !== '1')
    throw invalid();
  const point = bn254.G1.ProjectivePoint.fromAffine({
    x: coordinate(value[0]),
    y: coordinate(value[1]),
  });
  point.assertValidity();
  return point;
};
const g2 = (value: string[][]) => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((row) => !Array.isArray(row) || row.length !== 2) ||
    value[2][0] !== '1' ||
    value[2][1] !== '0'
  )
    throw invalid();
  const point = bn254.G2.ProjectivePoint.fromAffine({
    x: { c0: coordinate(value[0][0]), c1: coordinate(value[0][1]) },
    y: { c0: coordinate(value[1][0]), c1: coordinate(value[1][1]) },
  });
  point.assertValidity();
  return point;
};

/** Independently check generated proof against the pinned deployed Classic key. */
export function verifyPrivacyProof(proof: IProof, signals: string[]): boolean {
  try {
    if (!Array.isArray(signals) || signals.length !== 6) return false;
    const values = signals.map((value) => BigInt(decimal(value, FIELD)));
    const A = g1(proof.pi_a),
      B = g2(proof.pi_b),
      C = g1(proof.pi_c);
    let aggregate = g1(verificationKey.IC[0]);
    for (let i = 0; i < values.length; i++)
      if (values[i] !== BigInt(0))
        aggregate = aggregate.add(
          g1(verificationKey.IC[i + 1]).multiply(values[i])
        );
    const pairs = [
      { g1: A.negate(), g2: B },
      { g1: g1(verificationKey.vk_alfa_1), g2: g2(verificationKey.vk_beta_2) },
      { g1: aggregate, g2: g2(verificationKey.vk_gamma_2) },
      { g1: C, g2: g2(verificationKey.vk_delta_2) },
    ];
    return bn254.fields.Fp12.eql(
      bn254.pairingBatch(pairs),
      bn254.fields.Fp12.ONE
    );
  } catch {
    return false;
  }
}

export function encodePrivacyProof(
  proof: IProof,
  signals: string[]
): IPrivacyProofResult {
  if (!verifyPrivacyProof(proof, signals))
    throw new Error('privacy_proof_verification_failed');
  const coordinates = [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ];
  return {
    proof: `0x${coordinates
      .map((value) => coordinate(value).toString(16).padStart(64, '0'))
      .join('')}`,
    publicSignals: [...signals],
  };
}
