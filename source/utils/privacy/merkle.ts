import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';

export const FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
export const TREE_DEPTH = 20;
export const TREE_CAPACITY = 2 ** TREE_DEPTH;
export const MAX_LEAVES_PER_BATCH = 256;

// Deployed Solidity 0.5.8 MerkleTreeWithHistory. Verified Ethereum source:
// https://sourcify.dev/server/v2/contract/1/0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936?fields=sources
// TornadoCash_eth.sol SHA-256: 1956932a1bd892439c7909803c65872ec979bfedd8f146ebd79a4f4ab60e9a69.
// All four pinned pools have identical constructor and hashLeftRight blocks.
const ZEROES = [
  '0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c',
  '0x256a6135777eee2fd26f54b8b7037a25439d5235caee224154186d2b8a52e31d',
  '0x1151949895e82ab19924de92c40a3d6f7bcb60d92b00504b8199613683f0c200',
  '0x20121ee811489ff8d61f09fb89e313f14959a0f28bb428a20dba6b0b068b3bdb',
  '0x0a89ca6ffa14cc462cfedb842c30ed221a50a3d6bf022a6a57dc82ab24c157c9',
  '0x24ca05c2b5cd42e890d6be94c68d0689f4f21c9cec9c0f13fe41d566dfb54959',
  '0x1ccb97c932565a92c60156bdba2d08f3bf1377464e025cee765679e604a7315c',
  '0x19156fbd7d1a8bf5cba8909367de1b624534ebab4f0f79e003bccdd1b182bdb4',
  '0x261af8c1f0912e465744641409f622d466c3920ac6e5ff37e36604cb11dfff80',
  '0x0058459724ff6ca5a1652fcbc3e82b93895cf08e975b19beab3f54c217d1c007',
  '0x1f04ef20dee48d39984d8eabe768a70eafa6310ad20849d4573c3c40c2ad1e30',
  '0x1bea3dec5dab51567ce7e200a30f7ba6d4276aeaa53e2686f962a46c66d511e5',
  '0x0ee0f941e2da4b9e31c3ca97a40d8fa9ce68d97c084177071b3cb46cd3372f0f',
  '0x1ca9503e8935884501bbaf20be14eb4c46b89772c97b96e3b2ebf3a36a948bbd',
  '0x133a80e30697cd55d8f7d4b0965b7be24057ba5dc3da898ee2187232446cb108',
  '0x13e6d8fc88839ed76e182c2a779af5b2c0da9dd18c90427a644f7e148a6253b6',
  '0x1eb16b057a477f4bc8f572ea6bee39561098f78f15bfb3699dcbb7bd8db61854',
  '0x0da2cb16a1ceaabf1c16b838f7a9e3f2a3a3088d9e0a6debaa748114620696ea',
  '0x24a3b3d822420b14b5d8cb6c28a574f01e98ea9e940551d2ebd75cee12649f9d',
  '0x198622acbd783d1b0d9064105b1fc8e4d8889de95c4c519b3f635809fe6afc05',
] as const;

export const ZERO_VALUE = ZEROES[0];

const ZERO = BigInt(0);
const ROUNDS = 220;
let roundConstants: bigint[] | undefined;

const toHex = (value: bigint): string =>
  `0x${value.toString(16).padStart(64, '0')}`;

const fieldElement = (value: string): bigint => {
  if (
    typeof value !== 'string' ||
    !/^(?:0x[\da-fA-F]{1,64}|0|[1-9]\d{0,76})$/.test(value)
  ) {
    throw new Error('Invalid Merkle field element');
  }
  const result = BigInt(value);
  if (result >= FIELD_SIZE)
    throw new Error('Merkle element is outside the field');
  return result;
};

const constants = (): bigint[] => {
  if (!roundConstants) {
    const values = Array<bigint>(ROUNDS).fill(ZERO);
    let seed = keccak256(toUtf8Bytes('mimcsponge'));
    for (let i = 1; i < ROUNDS - 1; i += 1) {
      seed = keccak256(seed);
      values[i] = BigInt(seed) % FIELD_SIZE;
    }
    roundConstants = values;
  }
  return roundConstants;
};

// circomlibjs 0.1.2 MiMC sponge permutation, 220 rounds, exponent 5, key 0.
const permute = (left: bigint, right: bigint): [bigint, bigint] => {
  const values = constants();
  for (let i = 0; i < ROUNDS; i += 1) {
    const t = (left + values[i]) % FIELD_SIZE;
    const square = (t * t) % FIELD_SIZE;
    const fourth = (square * square) % FIELD_SIZE;
    const next = (right + fourth * t) % FIELD_SIZE;
    if (i === ROUNDS - 1) right = next;
    else {
      right = left;
      left = next;
    }
  }
  return [left, right];
};

/** Exact Classic hashLeftRight: two absorbed field elements, no byte hashing. */
export const hashPair = (left: string, right: string): string => {
  const a = fieldElement(left);
  const b = fieldElement(right);
  const [rate, capacity] = permute(a, ZERO);
  return toHex(permute((rate + b) % FIELD_SIZE, capacity)[0]);
};

export type MerkleWork = {
  complete: boolean;
  frontier: (string | null)[];
  nextIndex: number;
  root?: string;
};

/** Small, JSON-serializable calculation state; it does not authenticate a snapshot. */
export const createMerkleWork = (): MerkleWork => ({
  complete: false,
  frontier: Array<string | null>(TREE_DEPTH + 1).fill(null),
  nextIndex: 0,
});

const validateWork = (work: MerkleWork, leafCount: number): void => {
  if (
    !work ||
    typeof work.complete !== 'boolean' ||
    !Number.isInteger(work.nextIndex) ||
    work.nextIndex < 0 ||
    work.nextIndex > leafCount ||
    !Array.isArray(work.frontier) ||
    work.frontier.length !== TREE_DEPTH + 1
  ) {
    throw new Error('Invalid Merkle checkpoint');
  }
  for (let level = 0; level <= TREE_DEPTH; level += 1) {
    const occupied = Math.floor(work.nextIndex / 2 ** level) % 2 === 1;
    const value = work.frontier[level];
    if (occupied) fieldElement(value as string);
    else if (value !== null) throw new Error('Invalid Merkle frontier');
  }
};

const foldRoot = (work: MerkleWork): string => {
  // The deployed constructor fills zero0..zero19, then hashes zero19 once
  // more for roots[0]. There is no inclusion proof for an empty pool.
  if (work.nextIndex === 0)
    return hashPair(ZEROES[TREE_DEPTH - 1], ZEROES[TREE_DEPTH - 1]);
  if (work.nextIndex === TREE_CAPACITY) {
    return toHex(fieldElement(work.frontier[TREE_DEPTH] as string));
  }
  let root: string = ZERO_VALUE;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    root =
      Math.floor(work.nextIndex / 2 ** level) % 2 === 1
        ? hashPair(work.frontier[level] as string, root)
        : hashPair(root, ZEROES[level]);
  }
  return root;
};

/**
 * Consume at most maxLeaves from an unchanged, complete ordered leaf array.
 * Binary carries take O(n) total hashes; only the 21-slot frontier is persisted.
 * A structurally valid checkpoint is not proof of its consumed prefix: callers
 * must restart untrusted restored work and independently verify the final root.
 */
export const advanceMerkleWork = (
  work: MerkleWork,
  leaves: string[],
  maxLeaves = 128
): MerkleWork => {
  if (!Array.isArray(leaves) || leaves.length > TREE_CAPACITY) {
    throw new Error('Invalid Merkle leaf count');
  }
  if (
    !Number.isInteger(maxLeaves) ||
    maxLeaves < 1 ||
    maxLeaves > MAX_LEAVES_PER_BATCH
  ) {
    throw new Error('Invalid Merkle batch size');
  }
  validateWork(work, leaves.length);
  work.complete = false;
  delete work.root;
  const end = Math.min(work.nextIndex + maxLeaves, leaves.length);
  while (work.nextIndex < end) {
    let carry = toHex(fieldElement(leaves[work.nextIndex]));
    let index = work.nextIndex;
    let level = 0;
    while (index % 2 === 1) {
      carry = hashPair(work.frontier[level] as string, carry);
      work.frontier[level] = null;
      index = Math.floor(index / 2);
      level += 1;
    }
    work.frontier[level] = carry;
    work.nextIndex += 1;
  }
  if (work.nextIndex === leaves.length) {
    // Never accept a supplied complete flag or root as the computed result.
    work.root = foldRoot(work);
    work.complete = true;
  }
  return work;
};
