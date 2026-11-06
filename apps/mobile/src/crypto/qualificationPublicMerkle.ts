import {
  advanceMerkleWork,
  advanceMerkleWorkWithBatch,
  createMerkleWork,
} from '../../../../source/utils/privacy/merkle.ts';

type Executor = (
  program: Uint8Array,
  signal: AbortSignal,
  assertCurrent: () => void
) => Promise<Uint8Array>;

/** Public native bridge vectors. No wallet state or live snapshot is accessed. */
export async function qualifyNativePublicMerkle(execute: Executor) {
  const owner = new AbortController();
  const assertCurrent = () => {
    if (owner.signal.aborted) throw new Error('Retired public Merkle fixture');
  };
  const leaves = ['1', '2', '3', '4', '5'];
  const expected = advanceMerkleWork(createMerkleWork(), leaves);
  const actual = await advanceMerkleWorkWithBatch(createMerkleWork(), leaves, 128, {
    signal: owner.signal, assertCurrent,
    execute: (program, signal) => execute(program, signal, assertCurrent),
  });
  if (!actual.work.complete || actual.work.root !== expected.root ||
      JSON.stringify(actual.work.frontier) !== JSON.stringify(expected.frontier))
    throw new Error('Native public Merkle vector failed');

  let malformedRejected = false;
  try { await execute(new Uint8Array(3), owner.signal, assertCurrent); }
  catch { malformedRejected = true; }
  if (!malformedRejected) throw new Error('Native public Merkle admission failed');
  owner.abort();
  let retiredRejected = false;
  try { await execute(new Uint8Array(3), owner.signal, assertCurrent); }
  catch { retiredRejected = true; }
  if (!retiredRejected) throw new Error('Native public Merkle ownership failed');
  return Object.freeze({ passed: true as const, leaves: leaves.length });
}
