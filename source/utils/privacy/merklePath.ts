import {
  FIELD_SIZE,
  getMerkleZero,
  hashPair,
  TREE_CAPACITY,
  TREE_DEPTH,
} from './merkle';
import type { MerkleWork } from './merkle';

export const MERKLE_PATH_CACHE_LEVEL = 8;
const BLOCK_LEAVES = 2 ** MERKLE_PATH_CACHE_LEVEL;
const LEVELS = TREE_DEPTH - MERKLE_PATH_CACHE_LEVEL + 1;
export type MerklePathIndex = { levels: (string | undefined)[][] };
const unavailable = () => new Error('privacy_verification_pending');
const word = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^0x[0-9a-f]{64}$/.test(value) &&
  BigInt(value) < FIELD_SIZE;
const checkIndex = (index: MerklePathIndex) => {
  if (
    !index ||
    !Array.isArray(index.levels) ||
    index.levels.length !== LEVELS ||
    Array.from(index.levels).some(
      (nodes, level) =>
        !Array.isArray(nodes) || nodes.length > 2 ** (LEVELS - 1 - level)
    )
  )
    throw unavailable();
};

/** At most 8191 completed subtree roots at full capacity; no per-leaf table. */
export const createMerklePathIndex = (): MerklePathIndex => ({
  levels: Array.from({ length: LEVELS }, () => []),
});

/** Never mutate a published index when extending a verified prefix. */
export const copyMerklePathIndex = (
  index: MerklePathIndex
): MerklePathIndex => {
  checkIndex(index);
  return { levels: index.levels.map((nodes) => nodes.slice()) };
};

/** Receives already-computed binary-carry roots during ordinary verification. */
export function recordMerkleSubtree(
  index: MerklePathIndex,
  level: number,
  nodeIndex: number,
  root: string
): void {
  if (level < MERKLE_PATH_CACHE_LEVEL) return;
  if (
    !Number.isInteger(level) ||
    level > TREE_DEPTH ||
    !Number.isInteger(nodeIndex) ||
    nodeIndex < 0 ||
    nodeIndex >= 2 ** (TREE_DEPTH - level) ||
    !word(root)
  )
    throw unavailable();
  index.levels[level - MERKLE_PATH_CACHE_LEVEL][nodeIndex] = root;
}

/**
 * Local-only path extraction from a live verified prefix. Rehash one <=256-leaf
 * block; use cached complete upper subtrees and the frontier for its partial
 * right edge. Authenticate every returned path against the supplied live root.
 * This cache is volatile and must be rebuilt during verification after restart.
 */
export async function getMerklePath(
  index: MerklePathIndex,
  leaves: readonly string[],
  leafIndex: number,
  work: MerkleWork,
  options: { assertCurrent: () => void; yieldControl?: () => Promise<void> }
): Promise<{ pathElements: string[]; pathIndices: number[] }> {
  const check = () => {
    const result: unknown = options.assertCurrent();
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => undefined);
      throw unavailable();
    }
  };
  check();
  checkIndex(index);
  if (
    !Array.isArray(leaves) ||
    !leaves.length ||
    leaves.length > TREE_CAPACITY ||
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= leaves.length ||
    !word(leaves[leafIndex]) ||
    !work?.complete ||
    work.nextIndex !== leaves.length ||
    !word(work.root) ||
    !Array.isArray(work.frontier) ||
    work.frontier.length !== TREE_DEPTH + 1
  )
    throw unavailable();
  const expectedRoot = work.root;
  const pathIndices = Array.from(
    { length: TREE_DEPTH },
    (_, level) => Math.floor(leafIndex / 2 ** level) % 2
  );
  const pathElements: string[] = [];
  const yieldControl =
    options.yieldControl ||
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let hashes = 0;
  const hash = (left: string, right: string) => {
    hashes++;
    return hashPair(left, right);
  };
  const blockStart = Math.floor(leafIndex / BLOCK_LEAVES) * BLOCK_LEAVES;
  let nodes = leaves.slice(blockStart, blockStart + BLOCK_LEAVES);
  let localIndex = leafIndex - blockStart;
  for (let level = 0; level < MERKLE_PATH_CACHE_LEVEL; level++) {
    pathElements.push(nodes[localIndex ^ 1] ?? getMerkleZero(level));
    const next: string[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      next.push(hash(nodes[i], nodes[i + 1] ?? getMerkleZero(level)));
      if (hashes % 64 === 0) {
        check();
        await yieldControl();
        check();
      }
    }
    nodes = next;
    localIndex = Math.floor(localIndex / 2);
  }
  let partialBlock: string | undefined;
  const partial = () => {
    if (partialBlock) return partialBlock;
    let root = getMerkleZero(0);
    for (let level = 0; level < MERKLE_PATH_CACHE_LEVEL; level++) {
      if (Math.floor(leaves.length / 2 ** level) % 2) {
        const left = work.frontier[level];
        if (!word(left)) throw unavailable();
        root = hash(left, root);
      } else root = hash(root, getMerkleZero(level));
    }
    partialBlock = root;
    return root;
  };
  const upper = (level: number, nodeIndex: number): string => {
    const first = nodeIndex * 2 ** level;
    if (first >= leaves.length) return getMerkleZero(level);
    if (first + 2 ** level <= leaves.length) {
      const root = index.levels[level - MERKLE_PATH_CACHE_LEVEL][nodeIndex];
      if (!word(root)) throw unavailable();
      return root;
    }
    if (level === MERKLE_PATH_CACHE_LEVEL) return partial();
    return hash(
      upper(level - 1, nodeIndex * 2),
      upper(level - 1, nodeIndex * 2 + 1)
    );
  };
  for (let level = MERKLE_PATH_CACHE_LEVEL; level < TREE_DEPTH; level++)
    pathElements.push(upper(level, Math.floor(leafIndex / 2 ** level) ^ 1));
  let root = leaves[leafIndex];
  for (let level = 0; level < TREE_DEPTH; level++)
    root = pathIndices[level]
      ? hash(pathElements[level], root)
      : hash(root, pathElements[level]);
  check();
  if (root !== expectedRoot || work.root !== expectedRoot) throw unavailable();
  return { pathElements, pathIndices };
}
