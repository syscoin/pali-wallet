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
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: Buffer.alloc(32),
      index: 0,
      witnessUtxo: {
        script: Buffer.from(
          '00140000000000000000000000000000000000000000',
          'hex'
        ),
        value: BigInt(1000),
      },
    });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [Buffer.from('018efefeff010101808efefefefefeff03', 'hex')],
      }).output!,
      value: BigInt(0),
    });

    const summary = getSyscoinPsbtValueSummary(psbt);

    expect(summary.assetAllocations).toEqual([
      {
        assetGuid: '4294967297',
        values: [{ n: 1, value: '9007199254740993' }],
      },
    ]);
  });

  it('rejects conflicting witness and non-witness UTXO data', () => {
    const previousTransaction = emptyTransaction();
    previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    const previousScript = Buffer.from(
      '76a914000000000000000000000000000000000000000088ac',
      'hex'
    );
    previousTransaction.addOutput(previousScript, BigInt(5000));

    expect(() =>
      getSyscoinPsbtValueSummary({
        data: {
          inputs: [
            {
              nonWitnessUtxo: previousTransaction.toBuffer(),
              witnessUtxo: {
                script: previousScript,
                value: BigInt(1000),
              },
            },
          ],
        },
        txInputs: [{ hash: previousTransaction.getHash(), index: 0 }],
        txOutputs: [{ value: BigInt(0) }],
        extractTransaction: emptyTransaction,
      })
    ).toThrow('Conflicting PSBT input 0 UTXO data');
  });

  it('rejects a non-witness UTXO from a different transaction', () => {
    const referencedTransaction = emptyTransaction();
    referencedTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    referencedTransaction.addOutput(Buffer.from('51', 'hex'), BigInt(5000));

    const unrelatedTransaction = emptyTransaction();
    unrelatedTransaction.addInput(Buffer.alloc(32, 1), 0xffffffff);
    unrelatedTransaction.addOutput(Buffer.from('51', 'hex'), BigInt(5000));

    expect(() =>
      getSyscoinPsbtValueSummary({
        data: {
          inputs: [
            {
              nonWitnessUtxo: unrelatedTransaction.toBuffer(),
            },
          ],
        },
        txInputs: [{ hash: referencedTransaction.getHash(), index: 0 }],
        txOutputs: [{ value: BigInt(0) }],
        extractTransaction: emptyTransaction,
      })
    ).toThrow('PSBT input 0 previous transaction mismatch');
  });
});
