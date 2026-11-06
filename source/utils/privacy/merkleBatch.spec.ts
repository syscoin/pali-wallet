import { getBytes, hexlify } from 'ethers/utils';
import {
  advanceMerkleWork,
  advanceMerkleWorkWithBatch,
  createMerkleWork,
  FIELD_SIZE,
  getMerkleZero,
  hashPair,
  TREE_CAPACITY,
  TREE_DEPTH,
  ZERO_VALUE,
  type MerkleWork,
} from './merkle';

function evaluate(program: Uint8Array): Uint8Array {
  const wire = new DataView(
    program.buffer,
    program.byteOffset,
    program.byteLength
  );
  const count = wire.getUint16(1);
  const output = new Uint8Array(count * 32);
  expect(program[0]).toBe(1);
  expect(program.length).toBe(3 + 66 * count);
  for (let index = 0; index < count; index++) {
    const pair = [3 + 66 * index, 36 + 66 * index].map((offset) => {
      if (program[offset] === 0)
        return hexlify(program.subarray(offset + 1, offset + 33));
      expect(program[offset]).toBe(1);
      expect(program.subarray(offset + 3, offset + 33)).toEqual(
        new Uint8Array(30)
      );
      const reference = wire.getUint16(offset + 1);
      expect(reference).toBeLessThan(index);
      return hexlify(output.subarray(32 * reference, 32 * (reference + 1)));
    });
    output.set(getBytes(hashPair(pair[0]!, pair[1]!)), 32 * index);
  }
  return output;
}

const leaves = Array.from({ length: 41 }, (_, i) => String(i + 1));
const port = (execute = async (program: Uint8Array) => evaluate(program)) => ({
  signal: new AbortController().signal,
  assertCurrent() {},
  execute,
});

it('matches the existing shared checkpoints and subtree event order across continuation and final fold', async () => {
  let work = createMerkleWork();
  for (const limit of [1, 7, 16, 17]) {
    const expected = JSON.parse(JSON.stringify(work)) as MerkleWork;
    const subtrees: { level: number; index: number; root: string }[] = [];
    advanceMerkleWork(expected, leaves, limit, (level, index, root) =>
      subtrees.push({ level, index, root })
    );
    const original = JSON.stringify(work);
    const batch = await advanceMerkleWorkWithBatch(work, leaves, limit, port());
    expect(JSON.stringify(work)).toBe(original);
    expect(batch).toEqual({ work: expected, subtrees });
    work = batch.work;
  }
  expect(work.complete).toBe(true);
});

it('matches the deployed empty-pool fold and makes no executor call for an append without pairs', async () => {
  const execute = jest.fn(async (program: Uint8Array) => evaluate(program));
  const empty = await advanceMerkleWorkWithBatch(
    createMerkleWork(),
    [],
    1,
    port(execute)
  );
  expect(empty.work).toEqual(advanceMerkleWork(createMerkleWork(), [], 1));
  expect(execute).toHaveBeenCalledTimes(1);
  const prefix = await advanceMerkleWorkWithBatch(
    createMerkleWork(),
    leaves,
    1,
    port(execute)
  );
  expect(prefix.work).toEqual(advanceMerkleWork(createMerkleWork(), leaves, 1));
  expect(execute).toHaveBeenCalledTimes(1);
});

it('consumes the final twenty carries at tree capacity and needs no native call to fold a complete frontier', async () => {
  const full = Array<string>(TREE_CAPACITY).fill(ZERO_VALUE);
  const work = createMerkleWork();
  work.nextIndex = TREE_CAPACITY - 1;
  for (let level = 0; level < TREE_DEPTH; level++) {
    work.frontier[level] = getMerkleZero(level);
  }
  const expected = advanceMerkleWork(
    { ...work, frontier: [...work.frontier] },
    full,
    1
  );
  const execute = jest.fn(async (program: Uint8Array) => evaluate(program));
  const result = await advanceMerkleWorkWithBatch(work, full, 1, port(execute));
  expect(result.work).toEqual(expected);
  expect(result.subtrees).toHaveLength(TREE_DEPTH);
  expect(execute.mock.calls[0]?.[0]).toHaveLength(3 + TREE_DEPTH * 66);

  result.work.frontier[TREE_DEPTH] = BigInt(result.work.root!).toString();
  const restored = await advanceMerkleWorkWithBatch(
    result.work,
    full,
    1,
    port(execute)
  );
  expect(restored.work.root).toBe(expected.root);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('retires an in-flight result before returning checkpoint state or subtrees', async () => {
  let current = true;
  const work = createMerkleWork();
  const result = advanceMerkleWorkWithBatch(work, leaves, 4, {
    ...port(async (program) => {
      current = false;
      return evaluate(program);
    }),
    assertCurrent() {
      if (!current) throw new Error('retired owner');
    },
  });
  await expect(result).rejects.toThrow('retired owner');
  expect(work).toEqual(createMerkleWork());
});

it('refuses asynchronous owner checks before starting native work', async () => {
  const execute = jest.fn(async (program: Uint8Array) => evaluate(program));
  const work = createMerkleWork();
  await expect(
    advanceMerkleWorkWithBatch(work, leaves, 4, {
      ...port(execute),
      async assertCurrent() {
        throw new Error('retired owner');
      },
    })
  ).rejects.toThrow('privacy_sync_cancelled');
  expect(execute).not.toHaveBeenCalled();
  expect(work).toEqual(createMerkleWork());
});

it('checks intrinsic result length instead of overridable view properties', async () => {
  const work = createMerkleWork();
  const execute = async () => {
    let reads = 0;
    const short = new Uint8Array(1);
    Object.defineProperty(short, 'length', {
      get: () => (reads++ === 0 ? 32 : 0),
    });
    Object.defineProperty(short, 'subarray', {
      value: () => new Uint8Array(32),
    });
    return short;
  };
  await expect(
    advanceMerkleWorkWithBatch(work, leaves, 2, port(execute))
  ).rejects.toThrow('Invalid Merkle batch output');
  expect(work).toEqual(createMerkleWork());
});

it.each(['truncated', 'oversized', 'out of field'] as const)(
  'rejects %s results without changing the existing work',
  async (fault) => {
    const work = advanceMerkleWork(createMerkleWork(), leaves, 7);
    const original = JSON.stringify(work);
    const execute = async (program: Uint8Array) => {
      const bytes = evaluate(program);
      if (fault === 'truncated') return bytes.subarray(0, bytes.length - 1);
      if (fault === 'oversized') return new Uint8Array(bytes.length + 32);
      bytes.set(getBytes(`0x${FIELD_SIZE.toString(16)}`), bytes.length - 32);
      return bytes;
    };
    await expect(
      advanceMerkleWorkWithBatch(work, leaves, 20, port(execute))
    ).rejects.toThrow();
    expect(JSON.stringify(work)).toBe(original);
  }
);
