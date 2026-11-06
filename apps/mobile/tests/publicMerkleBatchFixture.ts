import assert from 'node:assert/strict';
import { getBytes, hexlify } from 'ethers/utils';
import { hashPair } from '../../../source/utils/privacy/merkle.ts';

export async function evaluateMerkleBatch(
  program: Uint8Array,
  signal: AbortSignal,
  check: () => void
): Promise<Uint8Array> {
  check();
  assert.equal(signal.aborted, false);
  const view = new DataView(
    program.buffer,
    program.byteOffset,
    program.byteLength
  );
  const count = view.getUint16(1);
  assert.equal(program[0], 1);
  assert.equal(program.length, 3 + 66 * count);
  assert(count > 0 && count <= 296);
  const output = new Uint8Array(32 * count);
  for (let index = 0; index < count; index++) {
    const operands = [3 + 66 * index, 36 + 66 * index].map((offset) => {
      if (program[offset] === 0)
        return hexlify(program.subarray(offset + 1, offset + 33));
      assert.equal(program[offset], 1);
      const reference = view.getUint16(offset + 1);
      assert(reference < index);
      assert.deepEqual(
        program.subarray(offset + 3, offset + 33),
        new Uint8Array(30)
      );
      return hexlify(output.subarray(reference * 32, (reference + 1) * 32));
    });
    output.set(getBytes(hashPair(operands[0]!, operands[1]!)), 32 * index);
  }
  check();
  return output;
}
