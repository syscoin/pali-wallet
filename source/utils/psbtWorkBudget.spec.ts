// Exercise the installed transitive parser used by syscoinjs-lib, without signing.
// eslint-disable-next-line import/no-extraneous-dependencies
import { Psbt } from 'bitcoinjs-lib';

import { assertPsbtWorkBudget, PSBT_WORK_LIMITS } from './psbtWorkBudget';

const script = Uint8Array.from([0x00, 0x14, ...new Array(20).fill(1)]);
const fixture = (inputs = 1, outputs = 1) => {
  const psbt = new Psbt();
  for (let i = 0; i < inputs; i++) {
    psbt.addInput({
      hash: new Uint8Array(32),
      index: i,
      witnessUtxo: { script, value: BigInt(1000) },
    });
  }
  for (let i = 0; i < outputs; i++)
    psbt.addOutput({ script, value: BigInt(1) });
  return { psbt: psbt.toBase64(), assets: '[]' };
};

describe('PSBT pre-parser work budget', () => {
  it('accepts real BitcoinJS PSBTs for normal sends and 200-input/output consolidation', () => {
    const ordinary = fixture();
    const before = JSON.stringify(ordinary);
    expect(() => assertPsbtWorkBudget(ordinary)).not.toThrow();
    expect(JSON.stringify(ordinary)).toBe(before);
    expect(() => assertPsbtWorkBudget(fixture(200, 200))).not.toThrow();
  });

  it('rejects 201 inputs or outputs before the full parser/signing traversal', () => {
    expect(() => assertPsbtWorkBudget(fixture(201, 1))).toThrow(
      '200 PSBT inputs'
    );
    expect(() => assertPsbtWorkBudget(fixture(1, 201))).toThrow(
      '200 PSBT outputs'
    );
  });

  it('rejects oversized encoded and decoded bodies', () => {
    expect(() =>
      assertPsbtWorkBudget({
        psbt: 'A'.repeat(Math.ceil(PSBT_WORK_LIMITS.bytes / 3) * 4 + 1),
      })
    ).toThrow('512 KiB');
    expect(() =>
      assertPsbtWorkBudget({
        psbt: Buffer.alloc(PSBT_WORK_LIMITS.bytes + 1).toString('base64'),
      })
    ).toThrow('512 KiB');
  });

  it('bounds parsed metadata and returns invalidParams for malformed metadata', () => {
    const data = fixture();
    expect(() =>
      assertPsbtWorkBudget({
        ...data,
        assets: JSON.stringify([['key', { name: 'token', amount: '100' }]]),
      })
    ).not.toThrow();
    expect(() =>
      assertPsbtWorkBudget({
        ...data,
        assets: JSON.stringify('a'.repeat(65536)),
      })
    ).toThrow('bytes');
    try {
      assertPsbtWorkBudget({ ...data, assets: '{bad' });
    } catch (error) {
      expect(error.code).toBe(-32602);
    }
    let deep: any = [];
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(() =>
      assertPsbtWorkBudget({ ...data, assets: JSON.stringify(deep) })
    ).toThrow('depth');
  });

  it('rejects map floods, invalid encoding, truncated framing and huge varints', () => {
    const data = Buffer.from(fixture().psbt, 'base64');
    // Global map starts with the unsigned transaction, with a one-byte length
    // in this small fixture. Insert unknown map entries before its terminator.
    const end = 5 + 1 + 1 + 1 + data[7];
    const pairs: Buffer[] = [];
    for (let i = 0; i < 4096; i++)
      pairs.push(Buffer.from([3, 0xfc, i & 255, i >> 8, 1, 0]));
    const flooded = Buffer.concat([
      data.subarray(0, end),
      ...pairs,
      data.subarray(end),
    ]);
    expect(() =>
      assertPsbtWorkBudget({ psbt: flooded.toString('base64') })
    ).toThrow('4096');
    expect(() => assertPsbtWorkBudget({ psbt: '!invalid' })).toThrow(
      'encoding'
    );
    expect(() =>
      assertPsbtWorkBudget({ psbt: data.subarray(0, 10).toString('base64') })
    ).toThrow('framing');
    expect(() =>
      assertPsbtWorkBudget({
        psbt: Buffer.from([
          0x70,
          0x73,
          0x62,
          0x74,
          0xff,
          0xff,
          ...new Array(8).fill(0xff),
        ]).toString('base64'),
      })
    ).toThrow('framing');
  });
});
