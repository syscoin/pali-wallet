import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBytes, hexlify } from 'ethers/utils';
import {
  advanceMerkleWork,
  advanceMerkleWorkWithBatch,
  createMerkleWork,
  FIELD_SIZE,
  hashPair,
} from '../../../../../source/utils/privacy/merkle.ts';

const [destination] = process.argv.slice(2);
assert(destination, 'Supply a scratch output directory');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const word = (value) => getBytes('0x' + BigInt(value).toString(16).padStart(64, '0'));
const u16 = (value) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
};
const cases = [];
const descriptions = [];

function record(name, program, output) {
  assert(program instanceof Uint8Array);
  assert(output instanceof Uint8Array);
  cases.push(Buffer.concat([u16(program.length), u16(output.length), program, output]));
  descriptions.push({ name, operations: output.length / 32 });
}

// This interprets pair references only. Merkle topology is produced by the
// actual shared planner and compared with its ordinary synchronous entry.
function evaluate(program) {
  const view = new DataView(program.buffer, program.byteOffset, program.byteLength);
  const count = view.getUint16(1);
  assert.equal(program[0], 1);
  assert(count > 0 && count <= 296);
  assert.equal(program.length, 3 + 66 * count);
  const output = new Uint8Array(count * 32);
  for (let index = 0; index < count; index++) {
    const operands = [3 + 66 * index, 36 + 66 * index].map((offset) => {
      if (program[offset] === 0) return hexlify(program.subarray(offset + 1, offset + 33));
      assert.equal(program[offset], 1);
      assert(program.subarray(offset + 3, offset + 33).every((value) => value === 0));
      const reference = view.getUint16(offset + 1);
      assert(reference < index);
      return hexlify(output.subarray(reference * 32, (reference + 1) * 32));
    });
    output.set(getBytes(hashPair(...operands)), index * 32);
  }
  return output;
}

async function advance(name, leaves, initial, limit) {
  const expected = structuredClone(initial);
  const subtrees = [];
  advanceMerkleWork(expected, leaves, limit, (level, index, root) => subtrees.push({ level, index, root }));
  const before = structuredClone(initial);
  let called = false;
  const result = await advanceMerkleWorkWithBatch(initial, leaves, limit, {
    signal: new AbortController().signal,
    assertCurrent() {},
    async execute(program) {
      assert.equal(called, false);
      called = true;
      const output = evaluate(program);
      record(name, program, output);
      return output;
    },
  });
  assert.deepEqual(initial, before);
  assert.deepEqual(result, { work: expected, subtrees });
  assert(called);
  return result.work;
}

const leaves = Array.from({ length: 257 }, (_, index) =>
  '0x' + (BigInt('0x' + sha256('Pali public Merkle fixture ' + index)) % FIELD_SIZE).toString(16)
);
await advance('empty fold', [], createMerkleWork(), 1);
await advance('five-leaf carries and fold', ['0', '1', '2', '3', '4'], createMerkleWork(), 5);
const first = await advance('prefix 127', leaves, createMerkleWork(), 127);
const second = await advance('continuation 128', leaves, first, 128);
await advance('final carry and fold', leaves, second, 2);
await advance('prefix 256', leaves, createMerkleWork(), 256);

// Maximum-size public dependency graph. Both operands sometimes refer to the
// same prior result, which is permitted and is distinct from buffer aliasing.
const operations = [];
const outputs = [];
let previous = FIELD_SIZE - 1n;
for (let index = 0; index < 296; index++) {
  const firstOperand = index === 0
    ? Buffer.concat([Buffer.from([0]), word(previous)])
    : Buffer.concat([Buffer.from([1]), u16(index - 1), Buffer.alloc(30)]);
  const duplicate = index > 0 && index % 7 === 1;
  const secondOperand = duplicate
    ? Buffer.concat([Buffer.from([1]), u16(index - 1), Buffer.alloc(30)])
    : Buffer.concat([Buffer.from([0]), word(index)]);
  const result = hashPair(previous.toString(), duplicate ? previous.toString() : String(index));
  operations.push(firstOperand, secondOperand);
  outputs.push(getBytes(result));
  previous = BigInt(result);
}
const program = Buffer.concat([Buffer.from([1]), u16(outputs.length), ...operations]);
const expected = Buffer.concat(outputs);
assert.deepEqual(evaluate(program), new Uint8Array(expected));
record('maximum dependency graph', program, expected);

const fixture = Buffer.concat(cases);
writeFileSync(join(destination, 'public-merkle-vectors.bin'), fixture);
console.log(JSON.stringify({ sha256: sha256(fixture), cases: descriptions }));
