jest.unmock('syscoinjs-lib');

import { Buffer as BrowserBuffer } from 'buffer/';
import {
  syscoin as SyscoinTransaction,
  utils as syscoinUtils,
} from 'syscoinjs-lib';

import { getSyscoinPsbtReviewError } from './syscoinPsbtReview';
import {
  getSyscoinPsbtValueSummary,
  getVerifiedSyscoinPsbtValueSummary,
} from './syscoinPsbtValues';

const syscointx = jest.requireActual('syscointx-js');
const CORE_WITNESS_COMMITMENT = Buffer.concat([
  Buffer.from('aa21a9ed', 'hex'),
  Buffer.alloc(32),
]);

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

const createUnfinalizedMintPsbt = (mintedAssetValue = '100000000') => {
  const allocationData = syscointx.bufferUtils.serializeAssetAllocations([
    {
      assetGuid: '123456',
      values: [
        {
          n: 0,
          value: new syscoinUtils.BN(mintedAssetValue),
        },
      ],
    },
  ]);
  const mintProof = syscointx.bufferUtils.serializeMintSyscoin({
    ethtxid: Buffer.alloc(32),
    blockhash: Buffer.alloc(32),
    txpos: 0,
    txparentnodes: Buffer.alloc(32),
    txpath: Buffer.alloc(1),
    receiptpos: 0,
    receiptparentnodes: Buffer.alloc(32),
    txroot: Buffer.alloc(32),
    receiptroot: Buffer.alloc(32),
  });
  const psbt = new syscoinUtils.bitcoinjs.Psbt({
    network: syscoinUtils.syscoinNetworks.testnet,
  });

  psbt.setVersion(140);
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
    script: Buffer.from('00140000000000000000000000000000000000000001', 'hex'),
    value: BigInt(9000),
  });
  psbt.addOutput({
    script: syscoinUtils.bitcoinjs.payments.embed({
      data: [Buffer.concat([allocationData, mintProof])],
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

const createAssetPrevout = () => {
  const allocationData = syscointx.bufferUtils.serializeAssetAllocations([
    {
      assetGuid: '4294967297',
      values: [{ n: 0, value: new syscoinUtils.BN(1) }],
    },
  ]);
  const previousTransaction = new syscoinUtils.bitcoinjs.Transaction();
  previousTransaction.version = 142;
  previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
  const assetScript = Buffer.from(
    '00140000000000000000000000000000000000000001',
    'hex'
  );
  previousTransaction.addOutput(assetScript, BigInt(546));
  previousTransaction.addOutput(
    syscoinUtils.bitcoinjs.payments.embed({ data: [allocationData] }).output!,
    BigInt(0)
  );

  return { allocationData, assetScript, previousTransaction };
};

const createAssetBearingV139Psbt = ({
  assetGuid = '123456',
  currentAssetValue = '2000000000',
  previousAssetValue = '1000000000',
}: {
  assetGuid?: string;
  currentAssetValue?: string;
  previousAssetValue?: string;
} = {}) => {
  const assetScript = Buffer.from(
    '00140000000000000000000000000000000000000001',
    'hex'
  );
  const previousAllocationData =
    syscointx.bufferUtils.serializeAssetAllocations([
      {
        assetGuid,
        values: [{ n: 1, value: new syscoinUtils.BN(previousAssetValue) }],
      },
    ]);
  const previousTransaction = new syscoinUtils.bitcoinjs.Transaction();
  previousTransaction.version = 139;
  previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
  previousTransaction.addOutput(
    syscoinUtils.bitcoinjs.payments.embed({
      data: [previousAllocationData],
    }).output!,
    BigInt('1000000000')
  );
  previousTransaction.addOutput(assetScript, BigInt('80000000000000'));

  const currentAllocationData = syscointx.bufferUtils.serializeAssetAllocations(
    [
      {
        assetGuid,
        values: [{ n: 1, value: new syscoinUtils.BN(currentAssetValue) }],
      },
    ]
  );
  const psbt = new syscoinUtils.bitcoinjs.Psbt({
    network: syscoinUtils.syscoinNetworks.testnet,
  });
  psbt.setVersion(139);
  psbt.addInput({
    hash: previousTransaction.getHash(),
    index: 1,
    nonWitnessUtxo: previousTransaction.toBuffer(),
  });
  psbt.addUnknownKeyValToInput(0, {
    key: Buffer.from('assetInfo'),
    value: Buffer.from(
      JSON.stringify({ assetGuid, value: previousAssetValue })
    ),
  });
  psbt.addOutput({
    script: syscoinUtils.bitcoinjs.payments.embed({
      data: [currentAllocationData],
    }).output!,
    value: BigInt('1000000000'),
  });
  psbt.addOutput({
    script: assetScript,
    value: BigInt('79998999999000'),
  });

  return { previousTransaction, psbt };
};

const createWitnessWrappedAssetPrevout = () => {
  const realAllocationData = syscointx.bufferUtils.serializeAssetAllocations([
    {
      assetGuid: '4294967297',
      values: [{ n: 1, value: new syscoinUtils.BN(1) }],
    },
  ]);
  const javascriptDecoy = Buffer.concat([
    Buffer.from('aa21a9ed00', 'hex'),
    Buffer.alloc(168 * 2),
    Buffer.alloc(169 * 2),
  ]);
  const previousTransaction = new syscoinUtils.bitcoinjs.Transaction();
  previousTransaction.version = 142;
  previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
  const assetScript = Buffer.from(
    '00140000000000000000000000000000000000000001',
    'hex'
  );
  previousTransaction.addOutput(
    syscoinUtils.bitcoinjs.payments.embed({
      data: [javascriptDecoy, realAllocationData],
    }).output!,
    BigInt(0)
  );
  previousTransaction.addOutput(assetScript, BigInt(546));

  return { assetScript, previousTransaction };
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

  it('reviews exact v140 bridge-mint allocations from an unfinalized SPSBT', () => {
    const mintedAssetValue = '100000000';
    const psbt = createUnfinalizedMintPsbt(mintedAssetValue);

    const transaction = psbt.extractTransaction(true, true);
    expect(psbt.data.inputs[0].finalScriptSig).toBeUndefined();
    expect(psbt.data.inputs[0].finalScriptWitness).toBeUndefined();
    expect(transaction.version).toBe(140);

    const summary = getSyscoinPsbtValueSummary(psbt);
    expect(summary).toEqual({
      assetAllocations: [
        {
          assetGuid: '123456',
          values: [{ n: 0, value: mintedAssetValue }],
        },
      ],
      feeSatoshis: '1000',
      outputValuesSatoshis: ['9000', '0'],
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

    expect(decoded.syscoin.txtype).toBe('assetallocation_mint');
    expect(
      getSyscoinPsbtReviewError(decoded, {
        '123456': { assetType: 'SYSX', decimals: 8, symbol: 'SYSX' },
      })
    ).toBeNull();
  });

  it('preserves v140 bridge-mint allocations above the safe integer limit', () => {
    const mintedAssetValue = '9007199254740993';

    expect(
      getSyscoinPsbtValueSummary(createUnfinalizedMintPsbt(mintedAssetValue))
        .assetAllocations
    ).toEqual([
      {
        assetGuid: '123456',
        values: [{ n: 0, value: mintedAssetValue }],
      },
    ]);
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
    psbt.addOutput({
      script: Buffer.from(
        '00140000000000000000000000000000000000000001',
        'hex'
      ),
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

  it('rejects a standard transaction that hides an asset-bearing input', async () => {
    const { assetScript, previousTransaction } = createAssetPrevout();

    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow(
      'Asset-bearing PSBT input 0 is not allowed in transaction version 2'
    );
  });

  it('rejects a standard transaction spending an asset hidden behind a Core witness-marker push', async () => {
    const { assetScript, previousTransaction } =
      createWitnessWrappedAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 1,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow(
      'Asset-bearing PSBT input 0 is not allowed in transaction version 2'
    );
  });

  it('accepts a standard transaction after hash-binding its witness prevout', async () => {
    const previousTransaction = emptyTransaction();
    previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    previousTransaction.addOutput(script, BigInt(1000));
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      witnessUtxo: { script, value: BigInt(1000) },
    });
    psbt.addOutput({ script, value: BigInt(900) });
    const fetchRawTransaction = jest.fn().mockResolvedValue({
      hex: previousTransaction.toHex(),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, fetchRawTransaction)
    ).resolves.toMatchObject({ feeSatoshis: '100', inputAssets: [] });
    expect(fetchRawTransaction).toHaveBeenCalledWith(
      previousTransaction.getId()
    );
  });

  it('verifies an embedded witness prevout with the browser Buffer polyfill', async () => {
    const previousTransaction = emptyTransaction();
    previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    previousTransaction.addOutput(script, BigInt(1000));
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
      witnessUtxo: { script, value: BigInt(1000) },
    });
    psbt.addOutput({ script, value: BigInt(900) });
    const originalBuffer = global.Buffer;
    global.Buffer = BrowserBuffer as unknown as typeof Buffer;

    try {
      await expect(
        getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
      ).resolves.toMatchObject({ feeSatoshis: '100', inputAssets: [] });
    } finally {
      global.Buffer = originalBuffer;
    }
  });

  it('deduplicates witness prevout lookups from the same transaction', async () => {
    const previousTransaction = emptyTransaction();
    previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    previousTransaction.addOutput(script, BigInt(1000));
    previousTransaction.addOutput(script, BigInt(2000));
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      witnessUtxo: { script, value: BigInt(1000) },
    });
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 1,
      witnessUtxo: { script, value: BigInt(2000) },
    });
    psbt.addOutput({ script, value: BigInt(2900) });
    const fetchRawTransaction = jest.fn().mockResolvedValue({
      hex: previousTransaction.toHex(),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, fetchRawTransaction)
    ).resolves.toMatchObject({ feeSatoshis: '100', inputAssets: [] });
    expect(fetchRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('bounds concurrent witness prevout lookups', async () => {
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    const previousTransactions = Array.from({ length: 12 }, (_, index) => {
      const previousTransaction = emptyTransaction();
      previousTransaction.addInput(Buffer.alloc(32, index + 1), 0xffffffff);
      previousTransaction.addOutput(script, BigInt(1000));
      return previousTransaction;
    });
    const previousTransactionsById = new Map(
      previousTransactions.map((transaction) => [
        transaction.getId(),
        transaction,
      ])
    );
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    for (const previousTransaction of previousTransactions) {
      psbt.addInput({
        hash: previousTransaction.getHash(),
        index: 0,
        witnessUtxo: { script, value: BigInt(1000) },
      });
    }
    psbt.addOutput({ script, value: BigInt(11900) });

    let activeLookups = 0;
    let maximumActiveLookups = 0;
    const fetchRawTransaction = jest.fn(async (txid: string) => {
      activeLookups += 1;
      maximumActiveLookups = Math.max(maximumActiveLookups, activeLookups);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeLookups -= 1;
      return { hex: previousTransactionsById.get(txid)?.toHex() };
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, fetchRawTransaction)
    ).resolves.toMatchObject({ feeSatoshis: '100', inputAssets: [] });
    expect(fetchRawTransaction).toHaveBeenCalledTimes(
      previousTransactions.length
    );
    expect(maximumActiveLookups).toBe(8);
  });

  it('stops scheduling witness prevout lookups after a failure', async () => {
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    const previousTransactions = Array.from({ length: 12 }, (_, index) => {
      const previousTransaction = emptyTransaction();
      previousTransaction.addInput(Buffer.alloc(32, index + 1), 0xffffffff);
      previousTransaction.addOutput(script, BigInt(1000));
      return previousTransaction;
    });
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(2);
    for (const previousTransaction of previousTransactions) {
      psbt.addInput({
        hash: previousTransaction.getHash(),
        index: 0,
        witnessUtxo: { script, value: BigInt(1000) },
      });
    }
    psbt.addOutput({ script, value: BigInt(11900) });

    let rejectFirstLookup: ((reason?: unknown) => void) | undefined;
    const settleActiveLookups: Array<() => void> = [];
    const previousTransactionsById = new Map(
      previousTransactions.map((transaction) => [
        transaction.getId(),
        transaction,
      ])
    );
    const fetchRawTransaction = jest.fn(
      (txid: string) =>
        new Promise((resolve, reject) => {
          if (!rejectFirstLookup) {
            rejectFirstLookup = reject;
          } else {
            settleActiveLookups.push(() =>
              resolve({ hex: previousTransactionsById.get(txid)?.toHex() })
            );
          }
        })
    );
    const verification = getVerifiedSyscoinPsbtValueSummary(
      psbt,
      fetchRawTransaction
    );

    expect(fetchRawTransaction).toHaveBeenCalledTimes(8);
    rejectFirstLookup?.(new Error('lookup failed'));
    await expect(verification).rejects.toThrow('lookup failed');
    settleActiveLookups.forEach((settle) => settle());
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchRawTransaction).toHaveBeenCalledTimes(8);
  });

  it('accepts a supported asset send whose inputs and outputs match exactly', async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [allocationData],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).resolves.toMatchObject({
      feeSatoshis: '46',
      inputAssets: [
        {
          assetGuid: '4294967297',
          inputIndex: 0,
          previousOutputIndex: 0,
          previousTxid: previousTransaction.getId(),
          value: '1',
        },
      ],
    });
  });

  it('accepts an authenticated v139 SYSX input that Core returns with the mint', async () => {
    const { previousTransaction, psbt } = createAssetBearingV139Psbt();

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).resolves.toEqual({
      assetAllocations: [
        {
          assetGuid: '123456',
          values: [{ n: 1, value: '2000000000' }],
        },
      ],
      feeSatoshis: '1000',
      inputAssets: [
        {
          assetGuid: '123456',
          inputIndex: 0,
          previousOutputIndex: 1,
          previousTxid: previousTransaction.getId(),
          value: '1000000000',
        },
      ],
      outputValuesSatoshis: ['1000000000', '79998999999000'],
    });
  });

  it('rejects a dapp PSBT input that does not bind every output', async () => {
    const { psbt } = createAssetBearingV139Psbt();
    psbt.updateInput(0, {
      sighashType: syscoinUtils.bitcoinjs.Transaction.SIGHASH_NONE,
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow('PSBT input 0 does not bind every output');
  });

  it('allows explicit SIGHASH_DEFAULT only for a Taproot input', async () => {
    const taprootScript = Buffer.concat([
      Buffer.from([syscoinUtils.bitcoinjs.opcodes.OP_1, 32]),
      Buffer.alloc(32, 1),
    ]);
    const previousTransaction = emptyTransaction();
    previousTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    previousTransaction.addOutput(taprootScript, BigInt(1000));
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    // bip174's updater rejects an explicit zero even though zero is the
    // serialized Taproot SIGHASH_DEFAULT value accepted in parsed PSBTs.
    psbt.data.inputs[0].sighashType =
      syscoinUtils.bitcoinjs.Transaction.SIGHASH_DEFAULT;
    psbt.addOutput({ script: taprootScript, value: BigInt(900) });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).resolves.toMatchObject({ feeSatoshis: '100', inputAssets: [] });
  });

  it('conserves unrelated asset inputs even in a v139 transaction', async () => {
    const { psbt } = createAssetBearingV139Psbt({
      assetGuid: '4294967297',
      currentAssetValue: '2',
      previousAssetValue: '1',
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow(
      'PSBT asset 4294967297 inputs do not match its serialized allocations'
    );
  });

  it('accepts the Core witness-marker form and uses its second pushed allocation payload', async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [CORE_WITNESS_COMMITMENT, allocationData],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).resolves.toMatchObject({
      assetAllocations: [
        {
          assetGuid: '4294967297',
          values: [{ n: 0, value: '1' }],
        },
      ],
      feeSatoshis: '46',
    });
  });

  it('rejects trailing pushes after the Core-selected Syscoin payload', async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [
          CORE_WITNESS_COMMITMENT,
          allocationData,
          Buffer.from('00', 'hex'),
        ],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow('Unable to verify Syscoin transaction data');
  });

  it('rejects a Core witness marker without a second pushed payload', async () => {
    const { assetScript, previousTransaction } = createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [CORE_WITNESS_COMMITMENT],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow('Unable to verify Syscoin transaction data');
  });

  it('rejects a second push when the first payload is not a Core witness marker', async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [allocationData, Buffer.from('00', 'hex')],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow('Unable to verify Syscoin transaction data');
  });

  it("does not skip Core's first unspendable output for a later parseable OP_RETURN", async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: Buffer.alloc(10_001, syscoinUtils.bitcoinjs.opcodes.OP_TRUE),
      value: BigInt(0),
    });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [allocationData],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow('Unable to verify Syscoin transaction data');
  });

  it('rejects an asset send whose serialized outputs do not conserve inputs', async () => {
    const { assetScript, previousTransaction } = createAssetPrevout();
    const mismatchedAllocationData =
      syscointx.bufferUtils.serializeAssetAllocations([
        {
          assetGuid: '4294967297',
          values: [{ n: 0, value: new syscoinUtils.BN(2) }],
        },
      ]);
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.setVersion(142);
    psbt.addInput({
      hash: previousTransaction.getHash(),
      index: 0,
      nonWitnessUtxo: previousTransaction.toBuffer(),
    });
    psbt.addUnknownKeyValToInput(0, {
      key: Buffer.from('assetInfo'),
      value: Buffer.from(
        JSON.stringify({ assetGuid: '4294967297', value: '1' })
      ),
    });
    psbt.addOutput({ script: assetScript, value: BigInt(500) });
    psbt.addOutput({
      script: syscoinUtils.bitcoinjs.payments.embed({
        data: [mismatchedAllocationData],
      }).output!,
      value: BigInt(0),
    });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(psbt, jest.fn())
    ).rejects.toThrow(
      'PSBT asset 4294967297 inputs do not match its serialized allocations'
    );
  });

  it('rejects omitted or conflicting asset input metadata', async () => {
    const { allocationData, assetScript, previousTransaction } =
      createAssetPrevout();
    const createPsbt = (metadata?: { assetGuid: string; value: string }) => {
      const psbt = new syscoinUtils.bitcoinjs.Psbt({
        network: syscoinUtils.syscoinNetworks.testnet,
      });
      psbt.setVersion(142);
      psbt.addInput({
        hash: previousTransaction.getHash(),
        index: 0,
        nonWitnessUtxo: previousTransaction.toBuffer(),
      });
      if (metadata) {
        psbt.addUnknownKeyValToInput(0, {
          key: Buffer.from('assetInfo'),
          value: Buffer.from(JSON.stringify(metadata)),
        });
      }
      psbt.addOutput({ script: assetScript, value: BigInt(500) });
      psbt.addOutput({
        script: syscoinUtils.bitcoinjs.payments.embed({
          data: [allocationData],
        }).output!,
        value: BigInt(0),
      });
      return psbt;
    };

    await expect(
      getVerifiedSyscoinPsbtValueSummary(createPsbt(), jest.fn())
    ).rejects.toThrow('PSBT input 0 omits its asset metadata');
    await expect(
      getVerifiedSyscoinPsbtValueSummary(
        createPsbt({ assetGuid: '4294967297', value: '2' }),
        jest.fn()
      )
    ).rejects.toThrow('Conflicting PSBT input 0 asset metadata');
  });

  it('rejects a fetched witness prevout whose hash does not match', async () => {
    const referencedTransaction = emptyTransaction();
    referencedTransaction.addInput(Buffer.alloc(32), 0xffffffff);
    const script = Buffer.from(
      '00140000000000000000000000000000000000000001',
      'hex'
    );
    referencedTransaction.addOutput(script, BigInt(1000));
    const unrelatedTransaction = emptyTransaction();
    unrelatedTransaction.addInput(Buffer.alloc(32, 1), 0xffffffff);
    unrelatedTransaction.addOutput(script, BigInt(1000));
    const psbt = new syscoinUtils.bitcoinjs.Psbt({
      network: syscoinUtils.syscoinNetworks.testnet,
    });
    psbt.addInput({
      hash: referencedTransaction.getHash(),
      index: 0,
      witnessUtxo: { script, value: BigInt(1000) },
    });
    psbt.addOutput({ script, value: BigInt(900) });

    await expect(
      getVerifiedSyscoinPsbtValueSummary(
        psbt,
        jest.fn().mockResolvedValue(unrelatedTransaction.toHex())
      )
    ).rejects.toThrow('PSBT input 0 previous transaction mismatch');
  });
});
