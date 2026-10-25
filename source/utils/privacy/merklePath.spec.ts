import * as merkle from './merkle';
import {
  copyMerklePathIndex,
  createMerklePathIndex,
  getMerklePath,
  recordMerkleSubtree,
} from './merklePath';

const word = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
function tree(count: number) {
  const leaves = Array.from({ length: count }, (_, i) => word(i + 1));
  const work = merkle.createMerkleWork(),
    index = createMerklePathIndex();
  do {
    merkle.advanceMerkleWork(work, leaves, 128, (level, node, root) =>
      recordMerkleSubtree(index, level, node, root)
    );
  } while (!work.complete);
  return { leaves, work, index };
}
function fullPath(leaves: string[], leafIndex: number) {
  const pathElements: string[] = [];
  let nodes = leaves,
    index = leafIndex;
  for (let level = 0; level < merkle.TREE_DEPTH; level++) {
    pathElements.push(nodes[index ^ 1] ?? merkle.getMerkleZero(level));
    const next = [];
    for (let i = 0; i < nodes.length; i += 2)
      next.push(
        merkle.hashPair(nodes[i], nodes[i + 1] ?? merkle.getMerkleZero(level))
      );
    nodes = next;
    index = Math.floor(index / 2);
  }
  return {
    pathElements,
    pathIndices: Array.from(
      { length: merkle.TREE_DEPTH },
      (_, level) => Math.floor(leafIndex / 2 ** level) % 2
    ),
  };
}
const options = () => ({
  assertCurrent: jest.fn(),
  yieldControl: async () => undefined,
});

it.each([1, 2, 255, 256, 257, 511, 512, 513, 700, 1024])(
  'matches independent full-tree paths for %s leaves including the partial right edge',
  async (count) => {
    const t = tree(count);
    for (const leafIndex of [
      ...new Set([0, Math.floor((count - 1) / 2), count - 1]),
    ])
      expect(
        await getMerklePath(t.index, t.leaves, leafIndex, t.work, options())
      ).toEqual(fullPath(t.leaves, leafIndex));
  }
);

it('copy-on-write preserves a published prefix while an append records new completed subtrees', async () => {
  const t = tree(300),
    old = JSON.stringify(t.index),
    next = copyMerklePathIndex(t.index);
  const leaves = Array.from({ length: 800 }, (_, i) => word(i + 1));
  const work = { ...t.work, frontier: [...t.work.frontier], complete: false };
  do {
    merkle.advanceMerkleWork(work, leaves, 128, (l, i, r) =>
      recordMerkleSubtree(next, l, i, r)
    );
  } while (!work.complete);
  expect(JSON.stringify(t.index)).toBe(old);
  expect(await getMerklePath(t.index, t.leaves, 0, t.work, options())).toEqual(
    fullPath(t.leaves, 0)
  );
  expect(await getMerklePath(next, leaves, 700, work, options())).toEqual(
    fullPath(leaves, 700)
  );
});

it.each(['missing', 'corrupt', 'partial-frontier', 'wrong-root'] as const)(
  'does not accept a %s node cache or silently rebuild the whole pool',
  async (kind) => {
    const t = tree(700);
    if (kind === 'missing') t.index.levels[0][1] = undefined;
    if (kind === 'corrupt') t.index.levels[0][1] = word(99);
    if (kind === 'partial-frontier') t.work.frontier[2] = word(99);
    if (kind === 'wrong-root') t.work.root = word(99);
    await expect(
      getMerklePath(t.index, t.leaves, 0, t.work, options())
    ).rejects.toThrow('privacy_verification_pending');
  }
);

it('bounds cache storage and extraction work at full tree capacity', async () => {
  const count = merkle.TREE_CAPACITY,
    root = merkle.hashPair(merkle.getMerkleZero(19), merkle.getMerkleZero(19));
  const index = createMerklePathIndex();
  for (let level = 8; level <= 20; level++)
    for (let i = 0; i < count / 2 ** level; i++)
      recordMerkleSubtree(
        index,
        level,
        i,
        level === 20 ? root : merkle.getMerkleZero(level)
      );
  expect(index.levels.reduce((sum, values) => sum + values.length, 0)).toBe(
    8191
  );
  expect(() => recordMerkleSubtree(index, 8, 4096, root)).toThrow();
  let reads = 0;
  const leaves = new Proxy(Array<string>(count).fill(merkle.ZERO_VALUE), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const work = merkle.createMerkleWork();
  work.nextIndex = count;
  work.complete = true;
  work.root = root;
  work.frontier[20] = root;
  const hash = jest.spyOn(merkle, 'hashPair');
  try {
    const path = await getMerklePath(index, leaves, 987654, work, options());
    expect(path.pathElements).toHaveLength(20);
    expect(hash.mock.calls.length).toBeLessThanOrEqual(300);
    expect(reads).toBeLessThanOrEqual(260);
  } finally {
    hash.mockRestore();
  }
});

it('rechecks the exact live lease after yielding and rejects async guard substitutes', async () => {
  const t = tree(600);
  let valid = true;
  await expect(
    getMerklePath(t.index, t.leaves, 0, t.work, {
      assertCurrent: () => {
        if (!valid) throw new Error('privacy_verification_pending');
      },
      yieldControl: async () => {
        valid = false;
      },
    })
  ).rejects.toThrow('privacy_verification_pending');
  await expect(
    getMerklePath(t.index, t.leaves, 0, t.work, {
      assertCurrent: (async () => undefined) as any,
    })
  ).rejects.toThrow('privacy_verification_pending');
});

it.each([-1, 0.5, 4])('rejects invalid leaf index %s', async (leafIndex) => {
  const t = tree(4);
  await expect(
    getMerklePath(t.index, t.leaves, leafIndex, t.work, options())
  ).rejects.toThrow();
});

it('refuses malformed cache shapes before copying or extracting paths', async () => {
  const index = createMerklePathIndex();
  index.levels[0] = Array(4097);
  expect(() => copyMerklePathIndex(index)).toThrow();
  const t = tree(1);
  await expect(
    getMerklePath(index, t.leaves, 0, t.work, options())
  ).rejects.toThrow();
});
