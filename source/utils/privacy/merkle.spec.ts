import {
  advanceMerkleWork,
  createMerkleWork,
  FIELD_SIZE,
  hashPair,
  MAX_LEAVES_PER_BATCH,
  TREE_CAPACITY,
  TREE_DEPTH,
  ZERO_VALUE,
} from './merkle';

const leavesFor = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => String(index + 1));

const finish = (leaves: string[], batch = 128) => {
  let work = createMerkleWork();
  do {
    work = advanceMerkleWork(work, leaves, batch);
  } while (!work.complete);
  return work;
};

it('matches the published circomlibjs 0.1.2 multiHash([1, 2]) vector', () => {
  // https://github.com/iden3/circomlibjs/blob/v0.1.2/test/mimcsponge.js
  expect(hashPair('1', '2')).toBe(
    '0x2bcea035a1251603f1ceaf73cd4ae89427c47075bb8e3a944039ff1e3d6d2a6f'
  );
  expect(hashPair('0x01', '0x02')).toBe(hashPair('1', '2'));
});

it.each([
  [
    '0',
    '0',
    '0x2d9fea8398a61ea1997e7d748364c0fdb49412c4dbabc1578375ade642e85581',
  ],
  [
    '2',
    '1',
    '0x1d853bcd317d6b6a6cde9a9969137327f7c756222d099cfdbc1cc6e70e17fbd6',
  ],
  [
    (FIELD_SIZE - BigInt(1)).toString(),
    (FIELD_SIZE - BigInt(2)).toString(),
    '0x2c870779f4362ba503fbb9eb83ef69dd2bf04a41135a3e82e648905ab8257d06',
  ],
])(
  'matches independent circomlibjs field vector (%s, %s)',
  (left, right, root) => {
    // Generated with unmodified npm circomlibjs@0.1.2 buildMimcSponge().multiHash.
    expect(hashPair(left, right)).toBe(root);
  }
);

it.each([
  [1, '0x0a8ab16921ac878ebf0edb3883cc1df6e0a443e09588af3cda17e41b4a7fb6f9'],
  [2, '0x2a8f5562e5e3f6c807682f10513c97c6e8f44bb90bcb8a7fb76aea8b4c66e3d8'],
  [3, '0x156c224f23b580116f1e543fc0b78ce38f1a4aa826f2460852cfbd0860da8dd8'],
  [5, '0x1815d9b4574f8c0be87e830f58a3b6dc7850b1905a25a2bcffd634ea1a869899'],
  [8, '0x2a1421679aa5f9e842210f4a0ae95eeb5e310aec8ed2a008b196df4a940a76ab'],
  [17, '0x0c3d323472500e279872737459b91e704a63d34696a8bb7811d3d7f4d7696cd8'],
])('matches the official depth-20 tree for %i leaves', (count, root) => {
  // Generated with npm fixed-merkle-tree@0.7.3 + circomlibjs@0.1.2,
  // leaves [1..count], Classic ZERO_VALUE, and sponge.multiHash([left, right]).
  const leaves = leavesFor(count as number);
  expect(finish(leaves).root).toBe(root);
  expect(leaves).toEqual(leavesFor(count as number));
});

it('matches the verified deployed constructor root for an empty depth-20 pool', () => {
  // Sourcify verified Ethereum 0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936,
  // TornadoCash_eth.sol:35-51. The other three pinned pools have identical
  // constructor and hashLeftRight blocks: fill zero0..zero19, then hash once.
  let zero19: string = ZERO_VALUE;
  for (let level = 1; level < TREE_DEPTH; level++)
    zero19 = hashPair(zero19, zero19);
  expect(zero19).toBe(
    '0x198622acbd783d1b0d9064105b1fc8e4d8889de95c4c519b3f635809fe6afc05'
  );
  const zero20 = hashPair(zero19, zero19);
  const work = finish([]);
  expect(work.nextIndex).toBe(0);
  expect(zero20).toBe(
    '0x29d7ed391256ccc3ea596c86e933b89ff339d25ea8ddced975ae2fe30b5296d4'
  );
  expect(work.root).toBe(zero20);
  expect(work.root).not.toBe(zero19);
});

it('resumes JSON checkpoints through carry boundaries without replaying leaves', () => {
  const leaves = leavesFor(17);
  let work = createMerkleWork();
  for (let index = 1; index <= leaves.length; index += 1) {
    work = advanceMerkleWork(JSON.parse(JSON.stringify(work)), leaves, 1);
    expect(work.nextIndex).toBe(index);
    expect(work.complete).toBe(index === leaves.length);
    expect(work.frontier).toHaveLength(TREE_DEPTH + 1);
    for (let level = 0; level <= TREE_DEPTH; level += 1) {
      expect(work.frontier[level] !== null).toBe(
        Math.floor(index / 2 ** level) % 2 === 1
      );
    }
  }
  expect(work.root).toBe(finish(leaves).root);
  expect(JSON.stringify(work).length).toBeLessThan(1600);
});

it('consumes at most the requested number of leaves and preserves partial work', () => {
  const work = createMerkleWork();
  const leaves = leavesFor(5);
  expect(advanceMerkleWork(work, leaves, 2)).toBe(work);
  expect(work).toMatchObject({ complete: false, nextIndex: 2 });
  expect(work.root).toBeUndefined();
  expect(work.frontier[0]).toBeNull();
  expect(work.frontier[1]).toBe(hashPair('1', '2'));
  advanceMerkleWork(work, leaves, 2);
  expect(work).toMatchObject({ complete: false, nextIndex: 4 });
  advanceMerkleWork(work, leaves, 2);
  expect(work).toMatchObject({ complete: true, nextIndex: 5 });
  expect(work.root).toBe(finish(leaves).root);
});

it('never accepts a supplied completion flag or root as its calculated result', () => {
  const work = createMerkleWork();
  work.complete = true;
  work.root = ZERO_VALUE;
  advanceMerkleWork(work, ['1']);
  expect(work.root).toBe(finish(['1']).root);
  work.root = ZERO_VALUE;
  advanceMerkleWork(work, ['1']);
  expect(work.root).toBe(finish(['1']).root);
});

it('keeps a twenty-first frontier slot for a completely full tree', () => {
  // The first 2^20-1 leaves are all ZERO_VALUE, so the occupied frontier consists
  // of the published zero subtree roots. Only the last leaf needs consuming.
  const work = createMerkleWork();
  let zero: string = ZERO_VALUE;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    work.frontier[level] = zero;
    zero = hashPair(zero, zero);
  }
  work.nextIndex = TREE_CAPACITY - 1;
  advanceMerkleWork(work, Array(TREE_CAPACITY).fill(ZERO_VALUE), 1);
  expect(work.nextIndex).toBe(TREE_CAPACITY);
  expect(work.frontier.slice(0, TREE_DEPTH)).toEqual(
    Array(TREE_DEPTH).fill(null)
  );
  expect(work.frontier[TREE_DEPTH]).toBe(
    '0x29d7ed391256ccc3ea596c86e933b89ff339d25ea8ddced975ae2fe30b5296d4'
  );
  expect(work.root).toBe(work.frontier[TREE_DEPTH]);
});

it.each([
  '',
  ' ',
  '-1',
  '+1',
  '01',
  '1e2',
  '0x',
  `0x${'1'.repeat(65)}`,
  FIELD_SIZE.toString(),
  `0x${FIELD_SIZE.toString(16)}`,
])('rejects an invalid or non-field element %s', (value) => {
  expect(() => hashPair(value, '0')).toThrow();
  expect(() => hashPair('0', value)).toThrow();
  expect(() => advanceMerkleWork(createMerkleWork(), [value])).toThrow();
});

it.each([0, -1, 1.5, NaN, Infinity, MAX_LEAVES_PER_BATCH + 1])(
  'rejects invalid batch size %s',
  (maxLeaves) => {
    expect(() =>
      advanceMerkleWork(createMerkleWork(), ['1'], maxLeaves)
    ).toThrow('Invalid Merkle batch size');
  }
);

it('rejects impossible checkpoints and oversized leaf sets', () => {
  const missing = createMerkleWork();
  missing.nextIndex = 1;
  expect(() => advanceMerkleWork(missing, ['1'])).toThrow();
  const extra = createMerkleWork();
  extra.frontier[0] = '1';
  expect(() => advanceMerkleWork(extra, ['1'])).toThrow();
  const beyond = createMerkleWork();
  beyond.nextIndex = 2;
  expect(() => advanceMerkleWork(beyond, ['1'])).toThrow();
  const malformed = createMerkleWork();
  malformed.frontier.pop();
  expect(() => advanceMerkleWork(malformed, ['1'])).toThrow();
  expect(() =>
    advanceMerkleWork(createMerkleWork(), Array(TREE_CAPACITY + 1))
  ).toThrow('Invalid Merkle leaf count');
});
