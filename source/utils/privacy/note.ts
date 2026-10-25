import { getPrivacyPool } from './registry';
import type { PrivacyPoolId } from './types';

// The background already carries this package's CommonJS arithmetic. Match
// that entry point so the note chunk does not add a second ESM copy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const edwards: typeof import('@noble/curves/abstract/edwards').edwards =
  require('@noble/curves/abstract/edwards').edwards;

const ORDER =
  BigInt(
    '21888242871839275222246405745257275088614511777268538073601725287587578984328'
  ) / BigInt(8);
const Point = edwards({
  p: BigInt(
    '21888242871839275222246405745257275088548364400416034343698204186575808495617'
  ),
  n: ORDER,
  h: BigInt(8),
  a: BigInt(168700),
  d: BigInt(168696),
  Gx: BigInt(
    '5299619240641551281634865583518297030282874472190772894086521144482721001553'
  ),
  Gy: BigInt(
    '16950150798460657717958625567821834550301663161624707787222815936182638968203'
  ),
});

// circomlibjs@0.1.7 PedersenGenerator, default BLAKE-256 derivation, segments
// 0..2. These are public protocol constants, not generated wallet secrets.
// Only the 31-byte nullifier and 62-byte Classic note preimage are supported.
const BASES = [
  [
    '10457101036533406547632367118273992217979173478358440826365724437999023779287',
    '19824078218392094440610104313265183977899662750282163392862422243483260492317',
  ],
  [
    '2671756056509184035029146175565761955751135805354291559563293617232983272177',
    '2663205510731142763556352975002641716101654201788071096152948830924149045094',
  ],
  [
    '5802099305472655231388284418920769829666717045250560929368476121199858275951',
    '5980429700218124965372158798884772646841287887664001482443826541541529227896',
  ],
].map(([x, y]) => {
  const point = Point.fromAffine({ x: BigInt(x), y: BigInt(y) });
  point.assertValidity();
  if (!point.isTorsionFree()) throw new Error('privacy_protocol_invalid');
  return point;
});

// Classic uses 4-bit signed windows and a radix of 32, with 50 windows per
// generator. Curve arithmetic comes from noble; no proving/runtime library is
// loaded to identify an imported note. Never use this as a generic hash.
function classicPedersenX(bytes: Uint8Array): string {
  if (bytes.length !== 31 && bytes.length !== 62)
    throw new Error('privacy_note_invalid');
  const bits = bytes.length * 8;
  let result = Point.ZERO;
  for (let segment = 0; segment * 200 < bits; segment++) {
    let scalar = BigInt(0);
    let power = BigInt(1);
    for (
      let offset = segment * 200;
      offset < Math.min(bits, (segment + 1) * 200);
      offset += 4
    ) {
      const nibble = (bytes[offset >>> 3] >>> (offset & 7)) & 15;
      const digit =
        BigInt(1 + (nibble & 7)) * (nibble & 8 ? BigInt(-1) : BigInt(1));
      scalar += digit * power;
      power <<= BigInt(5);
    }
    if (scalar < BigInt(0)) scalar += ORDER;
    if (scalar !== BigInt(0))
      result = result.add(BASES[segment].multiply(scalar));
  }
  return `0x${result.toAffine().x.toString(16).padStart(64, '0')}`;
}

export interface IClassicNoteIdentity {
  commitment: string;
  nullifierHash: string;
  poolId: PrivacyPoolId;
}

// This identifies a note, but does not admit it as funded or unspent. That
// requires a locally verified deposit snapshot and the bulk withdrawal feed.
// Errors are deliberately static so neither the note nor its bytes are logged.
export function identifyClassicNote(note: string): IClassicNoteIdentity {
  if (typeof note !== 'string' || note.length > 256)
    throw new Error('privacy_note_invalid');
  const match = /^tornado-eth-(0\.1|1|10|100)-1-0x([0-9a-fA-F]{124})$/.exec(
    note.trim()
  );
  if (!match) throw new Error('privacy_note_invalid');
  const poolId = `eth-${match[1]}` as PrivacyPoolId;
  getPrivacyPool(poolId);
  const preimage = new Uint8Array(62);
  try {
    for (let i = 0; i < preimage.length; i++)
      preimage[i] = Number.parseInt(match[2].slice(i * 2, i * 2 + 2), 16);
    return {
      commitment: classicPedersenX(preimage),
      nullifierHash: classicPedersenX(preimage.subarray(0, 31)),
      poolId,
    };
  } finally {
    preimage.fill(0);
  }
}
