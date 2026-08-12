jest.unmock('syscoinjs-lib');

import { utils as syscoinUtils } from 'syscoinjs-lib';

import { getSyscoinPsbtValueSummary } from './syscoinPsbtValues';

const emptyTransaction = () => {
  const transaction = new syscoinUtils.bitcoinjs.Transaction();
  transaction.version = 2;
  return transaction;
};

describe('Syscoin PSBT value summary', () => {
  it('computes the exact fee and output values from witness inputs', () => {
    const summary = getSyscoinPsbtValueSummary({
      data: {
        inputs: [
          { witnessUtxo: { value: BigInt('9007199254740991') } },
          { witnessUtxo: { value: BigInt(1000) } },
        ],
      },
      txInputs: [{ index: 0 }, { index: 1 }],
      txOutputs: [
        { value: BigInt('9007199254740000') },
        { value: BigInt(500) },
      ],
      extractTransaction: emptyTransaction,
    });

    expect(summary).toEqual({
      assetAllocations: [],
      feeSatoshis: '1491',
      outputValuesSatoshis: ['9007199254740000', '500'],
    });
  });

  it('fails closed when an input value is unavailable', () => {
    expect(() =>
      getSyscoinPsbtValueSummary({
        data: { inputs: [{}] },
        txInputs: [{ index: 0 }],
        txOutputs: [{ value: BigInt(1) }],
        extractTransaction: emptyTransaction,
      })
    ).toThrow('Unable to verify PSBT input 0');
  });

  it('rejects outputs whose value exceeds the inputs', () => {
    expect(() =>
      getSyscoinPsbtValueSummary({
        data: { inputs: [{ witnessUtxo: { value: BigInt(1) } }] },
        txInputs: [{ index: 0 }],
        txOutputs: [{ value: BigInt(2) }],
        extractTransaction: emptyTransaction,
      })
    ).toThrow('PSBT outputs exceed its inputs');
  });

  it('extracts large asset allocations as exact decimal strings', () => {
    const transaction = emptyTransaction();
    transaction.version = 142;
    transaction.addOutput(
      syscoinUtils.bitcoinjs.payments.embed({
        data: [Buffer.from('018efefeff010101808efefefefefeff03', 'hex')],
      }).output!,
      BigInt(0)
    );

    const summary = getSyscoinPsbtValueSummary({
      data: { inputs: [{ witnessUtxo: { value: BigInt(1000) } }] },
      txInputs: [{ index: 0 }],
      txOutputs: [{ value: BigInt(0) }],
      extractTransaction: () => transaction,
    });

    expect(summary.assetAllocations).toEqual([
      {
        assetGuid: '4294967297',
        values: [{ n: 1, value: '9007199254740993' }],
      },
    ]);
  });
});
