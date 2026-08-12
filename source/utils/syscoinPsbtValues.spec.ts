jest.unmock('syscoinjs-lib');

import {
  syscoin as SyscoinTransaction,
  utils as syscoinUtils,
} from 'syscoinjs-lib';

import { getSyscoinPsbtReviewError } from './syscoinPsbtReview';
import { getSyscoinPsbtValueSummary } from './syscoinPsbtValues';

const syscointx = jest.requireActual('syscointx-js');

const createUnfinalizedBurnToSyscoinPsbt = ({
  allocationAssetGuid = '123456',
  allocationOutputIndex = 2,
  allocationValue = '100000000',
  mintedSys = BigInt(100000000),
}: {
  allocationAssetGuid?: string;
  allocationOutputIndex?: number;
  allocationValue?: string;
  mintedSys?: bigint;
} = {}) => {
  const allocationData = syscointx.bufferUtils.serializeAssetAllocations([
    {
      assetGuid: allocationAssetGuid,
      values: [
        {
          n: allocationOutputIndex,
          value: new syscoinUtils.BN(allocationValue),
        },
      ],
    },
  ]);
  const burnData = syscointx.bufferUtils.serializeAllocationBurn({
    ethaddress: Buffer.alloc(0),
  });
  const psbt = new syscoinUtils.bitcoinjs.Psbt({
    network: syscoinUtils.syscoinNetworks.testnet,
  });

  psbt.setVersion(138);
  psbt.addInput({
    hash: Buffer.alloc(32),
    index: 0,
    witnessUtxo: {
      script: Buffer.from(
        '00140000000000000000000000000000000000000000',
        'hex'
      ),
      value: BigInt(10000),
    },
  });
  psbt.addOutput({
    script: Buffer.from('00140000000000000000000000000000000000000000', 'hex'),
    value: mintedSys,
  });
  psbt.addOutput({
    script: Buffer.from('00140000000000000000000000000000000000000001', 'hex'),
    value: BigInt(9000),
  });
  psbt.addOutput({
    script: syscoinUtils.bitcoinjs.payments.embed({
      data: [Buffer.concat([allocationData, burnData])],
    }).output!,
    value: BigInt(0),
  });

  return psbt;
};

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
    ).toThrow('PSBT outputs exceed its effective inputs');
  });

  it('accounts for the exact SYSX burned into native SYS in an unfinalized v138 SPSBT', () => {
    const psbt = createUnfinalizedBurnToSyscoinPsbt();
    const transaction = psbt.extractTransaction(true, true);
    const rawInput = BigInt(psbt.data.inputs[0].witnessUtxo!.value);
    const rawOutput = transaction.outs.reduce(
      (total: bigint, output: any) => total + BigInt(output.value),
      BigInt(0)
    );

    expect(psbt.data.inputs[0].finalScriptSig).toBeUndefined();
    expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    expect(transaction.version).toBe(138);
    expect(transaction.outs[0].value).toBe(BigInt(100000000));
    expect(rawOutput).toBeGreaterThan(rawInput);

    const summary = getSyscoinPsbtValueSummary(psbt);
    expect(rawInput + transaction.outs[0].value).toBeGreaterThanOrEqual(
      rawOutput
    );
    expect(summary).toEqual({
      assetAllocations: [
        {
          assetGuid: '123456',
          values: [{ n: 2, value: '100000000' }],
        },
      ],
      feeSatoshis: '1000',
      outputValuesSatoshis: ['100000000', '9000', '0'],
    });

    const decoder = new SyscoinTransaction(
      null,
      null,
      syscoinUtils.syscoinNetworks.testnet
    );
    const decoded = decoder.decodeRawTransaction(psbt);
    decoded.feeSatoshis = summary.feeSatoshis;
    decoded.vout.forEach((output: any, index: number) => {
      output.valueSatoshis = summary.outputValuesSatoshis[index];
    });
    decoded.syscoin.allocations = { assets: summary.assetAllocations };

    expect(
      getSyscoinPsbtReviewError(decoded, {
        '123456': { assetType: 'SYSX', decimals: 8, symbol: 'SYSX' },
      })
    ).toBeNull();
  });

  it('counts the value-bearing SYS burn output when computing a v139 fee', () => {
    const allocationData = syscointx.bufferUtils.serializeAssetAllocations([
      {
        assetGuid: '123456',
        values: [{ n: 0, value: new syscoinUtils.BN('100000000') }],
      },
    ]);
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });

    psbt.setVersion(139);
    psbt.addInput({
      hash: Buffer.alloc(32),
      index: 0,
      witnessUtxo: {
        script: Buffer.from(
          '00140000000000000000000000000000000000000000',
          'hex'
        ),
        value: BigInt(100010000),
      },
    });
    psbt.addOutput({
      script: Buffer.from(
        '00140000000000000000000000000000000000000001',
        'hex'
      ),
      value: BigInt(9000),
    });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [allocationData],
      }).output!,
      value: BigInt(100000000),
    });

    expect(getSyscoinPsbtValueSummary(psbt)).toEqual({
      assetAllocations: [
        {
          assetGuid: '123456',
          values: [{ n: 0, value: '100000000' }],
        },
      ],
      feeSatoshis: '1000',
      outputValuesSatoshis: ['9000', '100000000'],
    });
  });

  it.each([
    ['a non-SYSX allocation', { allocationAssetGuid: '123457' }],
    ['a burn assigned to a spendable output', { allocationOutputIndex: 1 }],
    ['a burn amount different from output zero', { allocationValue: '1' }],
  ])('rejects v138 with %s', (_description, fixtureOptions) => {
    expect(() =>
      getSyscoinPsbtValueSummary(
        createUnfinalizedBurnToSyscoinPsbt(fixtureOptions)
      )
    ).toThrow('SYSX burn amount does not match the native SYS mint output');
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
