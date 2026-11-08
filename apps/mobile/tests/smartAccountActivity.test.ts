import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress, Wallet, Transaction } from 'ethers';
import {
  encodeErc20Transfer,
  type Erc20Metadata,
} from '../../../source/shared/erc20.ts';
import {
  decodeRetainedSmartAccountTransfer,
  decodeRetainedSmartAccountOperations,
  observeSmartAccountActivity,
} from '../../../source/wallet/smartAccountActivity.ts';
import {
  getPaliEntryPointAddress,
  getPaliModuleAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../../../source/utils/smartAccount/contracts.ts';
import { ERC7579_MODE_SINGLE_DEFAULT } from '../../../source/utils/smartAccount/account.ts';
import type { EvmRetainedSignedRecord } from '../../../source/wallet/evmSignedRecords.ts';

const account = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const payer = new Wallet('0x' + '33'.repeat(32));
const blockHash = '0x' + '44'.repeat(32);
async function signed(token?: Erc20Metadata) {
  const operation = {
    sender: account,
    nonce: 7n,
    initCode: '0x',
    callData: paliSmartAccountInterface.encodeFunctionData('execute', [
      ERC7579_MODE_SINGLE_DEFAULT,
      (token?.contractAddress ?? recipient) +
        (token
          ? '0'.repeat(64) + encodeErc20Transfer(recipient, '9').slice(2)
          : 9n.toString(16).padStart(64, '0')),
    ]),
    accountGasLimits:
      '0x' + '00'.repeat(12) + '000186a0' + '00'.repeat(12) + '000186a0',
    preVerificationGas: 21000,
    gasFees: '0x' + '00'.repeat(15) + '01' + '00'.repeat(15) + '03',
    paymasterAndData: '0x',
    signature: '0x1234',
  };
  const rawTransaction = await payer.signTransaction({
    chainId: 1,
    nonce: 0,
    to: getPaliEntryPointAddress(1),
    value: 0,
    gasLimit: 300000,
    gasPrice: 2,
    type: 0,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      [operation],
      payer.address,
    ]),
  });
  const tx = Transaction.from(rawTransaction);
  const entry: EvmRetainedSignedRecord = {
    chainId: '1',
    from: payer.address,
    hash: tx.hash!,
    nonce: 0,
    createdAt: 1,
    phase: 'submitted',
    operation: 'send',
    signer: { id: 0, type: 'HDAccount' },
    rawTransaction,
    metadata: {
      smartAccountExecution: true,
      smartAccountExecutionFrom: account,
      ...(token ? { smartAccountToken: token } : {}),
    },
  };
  const transfer = decodeRetainedSmartAccountTransfer(entry, account)!;
  assert(transfer);
  const observation = {
    chainId: entry.chainId,
    hash: entry.hash,
    payer: entry.from,
    nonce: entry.nonce,
    account,
    operationHash: transfer.operationHash,
    operationNonce: transfer.operationNonce,
  };
  return { entry, transfer, observation };
}

test('Smart projection authenticates inner amount and identity from the signed outer transaction', async () => {
  const { entry, transfer } = await signed();
  assert.equal(transfer.recipient, recipient);
  assert.equal(transfer.amountUnits, '9');
  assert.equal(transfer.operationNonce, '7');
  assert.equal(transfer.entry.from, payer.address);
  assert.equal(decodeRetainedSmartAccountTransfer(entry, recipient), null);
  assert.equal(
    decodeRetainedSmartAccountTransfer({ ...entry, hash: blockHash }, account),
    null
  );
  assert.equal(
    decodeRetainedSmartAccountTransfer({ ...entry, nonce: 99 }, account),
    null
  );
  assert.equal(
    decodeRetainedSmartAccountTransfer({ ...entry, from: recipient }, account),
    null
  );
  assert.equal(
    decodeRetainedSmartAccountTransfer(
      {
        ...entry,
        metadata: { ...entry.metadata, smartAccountOperationHash: blockHash },
      },
      account
    ),
    null
  );
});

for (const success of [true, false])
  test(`Smart activity observes the inner ${
    success ? 'successful' : 'failed'
  } result with one receipt`, async () => {
    const { transfer, observation: expected } = await signed();
    let receipts = 0;
    const event = paliEntryPointInterface.encodeEventLog(
      paliEntryPointInterface.getEvent('UserOperationEvent')!,
      [
        transfer.operationHash,
        account,
        '0x' + '00'.repeat(20),
        7,
        success,
        100,
        50,
      ]
    );
    const observation = await observeSmartAccountActivity(
      expected,
      async (method) => {
        if (method === 'eth_chainId') return '0x1';
        if (method === 'eth_getBlockByNumber')
          return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
        if (method === 'eth_getTransactionReceipt') {
          receipts++;
          return {
            transactionHash: transfer.entry.hash,
            from: payer.address,
            to: getPaliEntryPointAddress(1),
            status: '0x1',
            blockNumber: '0x10',
            blockHash,
            logs: [
              {
                ...event,
                address: getPaliEntryPointAddress(1),
                transactionHash: transfer.entry.hash,
                blockHash,
                blockNumber: '0x10',
              },
            ],
          };
        }
        assert.fail(method);
      },
      () => undefined
    );
    assert.equal(observation.status, 'mined');
    assert.equal(
      observation.status === 'mined' && observation.outcome,
      success ? 'confirmed' : 'reverted'
    );
    assert.equal(receipts, 1);
  });

test('outer success without the exact inner event cannot confirm a Smart transfer', async () => {
  const { transfer, observation: expected } = await signed();
  await assert.rejects(
    observeSmartAccountActivity(
      expected,
      async (method) => {
        if (method === 'eth_chainId') return '0x1';
        if (method === 'eth_getBlockByNumber')
          return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
        return {
          transactionHash: transfer.entry.hash,
          from: payer.address,
          to: getPaliEntryPointAddress(1),
          status: '0x1',
          blockNumber: '0x10',
          blockHash,
          logs: [],
        };
      },
      () => undefined
    ),
    /outcome unavailable/
  );
});

test('Smart ERC20 Activity binds display metadata to the authenticated inner token contract', async () => {
  const token = {
    contractAddress: '0x5555555555555555555555555555555555555555',
    name: 'Token',
    symbol: 'TKN',
    decimals: 255,
  };
  const { entry, transfer } = await signed(token);
  assert.equal(transfer.amountUnits, '9');
  assert.equal(transfer.recipient, recipient);
  assert.deepEqual(transfer.token, token);
  assert.equal(
    decodeRetainedSmartAccountTransfer(
      {
        ...entry,
        metadata: {
          ...entry.metadata,
          smartAccountToken: { ...token, contractAddress: account },
        },
      },
      account
    ),
    null
  );
});


test('nonce identities include authenticated handleOps from any payer and execution mode without metadata', async () => {
  const original = await signed();
  const outer = Transaction.from(original.entry.rawTransaction);
  const [operations] = paliEntryPointInterface.decodeFunctionData('handleOps', outer.data);
  const raw = operations[0];
  const op = { sender: raw.sender, nonce: raw.nonce, initCode: raw.initCode, callData: '0x12345678', accountGasLimits: raw.accountGasLimits,
    preVerificationGas: raw.preVerificationGas, gasFees: raw.gasFees, paymasterAndData: raw.paymasterAndData, signature: raw.signature };
  const secondPayer = new Wallet('0x' + '55'.repeat(32));
  for (const owner of [payer, secondPayer]) {
    const bytes = await owner.signTransaction({ chainId: 1, nonce: 0, to: getPaliEntryPointAddress(1), gasLimit: 500000, gasPrice: 2,
      data: paliEntryPointInterface.encodeFunctionData('handleOps', [[op, { ...op, nonce: 8 }], owner.address]) });
    const tx = Transaction.from(bytes);
    const entry = { ...original.entry, metadata: undefined, from: owner.address, hash: tx.hash!, rawTransaction: bytes };
    assert.deepEqual(decodeRetainedSmartAccountOperations(entry).map(value => [value.payer, value.operationNonce]), [[owner.address, '7'], [owner.address, '8']]);
    assert.equal(decodeRetainedSmartAccountOperations({ ...entry, from: recipient }).length, 0);
  }
});


async function guardianRemovalEntry(
  createCall: (
    removalData: string,
    singleCall: (data: string, target?: string, value?: bigint) => string
  ) => string,
  owner = payer,
  mixOtherOperation = false
) {
  const original = await signed();
  const raw = paliEntryPointInterface.decodeFunctionData(
    'handleOps',
    Transaction.from(original.entry.rawTransaction).data
  )[0][0];
  const singleCall = (data: string, target = account, value = 0n) =>
    paliSmartAccountInterface.encodeFunctionData('execute', [
      ERC7579_MODE_SINGLE_DEFAULT,
      target + value.toString(16).padStart(64, '0') + data.slice(2),
    ]);
  const removalData = paliSmartAccountInterface.encodeFunctionData(
    'uninstallModule',
    [2, getPaliModuleAddress(1, 'guardian-recovery'), '0x']
  );
  const operation = {
    sender: raw.sender,
    nonce: raw.nonce,
    initCode: raw.initCode,
    callData: createCall(removalData, singleCall),
    accountGasLimits: raw.accountGasLimits,
    preVerificationGas: raw.preVerificationGas,
    gasFees: raw.gasFees,
    paymasterAndData: raw.paymasterAndData,
    signature: raw.signature,
  };
  const operations = mixOtherOperation
    ? [
        { ...operation, nonce: 6, callData: singleCall('0x', recipient, 9n) },
        operation,
      ]
    : [operation];
  const rawTransaction = await owner.signTransaction({
    type: 0,
    chainId: 1,
    nonce: 0,
    to: getPaliEntryPointAddress(1),
    value: 0,
    gasLimit: 300000,
    gasPrice: 2,
    data: paliEntryPointInterface.encodeFunctionData('handleOps', [
      operations,
      owner.address,
    ]),
  });
  return {
    ...original.entry,
    from: owner.address,
    rawTransaction,
    hash: Transaction.from(rawTransaction).hash!,
    metadata: undefined,
  };
}

test('guardian removal projection preserves authenticated identities across payers and mixed operations', async () => {
  const secondPayer = new Wallet('0x' + '55'.repeat(32));
  for (const owner of [payer, secondPayer]) {
    const entry = await guardianRemovalEntry(
      (data, single) => single(data),
      owner,
      true
    );
    const operations = decodeRetainedSmartAccountOperations(entry);
    assert.equal(operations.length, 2);
    assert.equal(operations[0]!.guardianRemoval, undefined);
    const removal = operations[1]!;
    assert.deepEqual(removal.guardianRemoval, {
      moduleAddress: getAddress(getPaliModuleAddress(1, 'guardian-recovery')),
    });
    assert.equal(removal.account, account);
    assert.equal(removal.payer, owner.address);
    assert.equal(removal.hash, entry.hash);
    assert.equal(removal.operationNonce, '7');
    assert(Object.isFrozen(removal.guardianRemoval));
    assert.equal('callData' in removal, false);
    assert.equal('signature' in removal, false);
    assert.equal(
      decodeRetainedSmartAccountOperations({ ...entry, hash: blockHash })
        .length,
      0
    );
    assert.equal(
      decodeRetainedSmartAccountOperations({ ...entry, chainId: '2' }).length,
      0
    );
    assert.equal(
      decodeRetainedSmartAccountOperations({ ...entry, from: recipient })
        .length,
      0
    );
  }
});

for (const scenario of [
  'wrong-target',
  'nonzero-value',
  'wrong-module',
  'validator-type',
  'nonempty-deinit',
  'trailing-uninstall',
  'trailing-execute',
  'other-mode',
] as const)
  test(`guardian removal requires exact canonical execution (${scenario})`, async () => {
    const entry = await guardianRemovalEntry((data, single) => {
      if (scenario === 'wrong-target') return single(data, recipient);
      if (scenario === 'nonzero-value') return single(data, account, 1n);
      if (scenario === 'wrong-module')
        return single(
          paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
            2,
            recipient,
            '0x',
          ])
        );
      if (scenario === 'validator-type')
        return single(
          paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
            1,
            getPaliModuleAddress(1, 'guardian-recovery'),
            '0x',
          ])
        );
      if (scenario === 'nonempty-deinit')
        return single(
          paliSmartAccountInterface.encodeFunctionData('uninstallModule', [
            2,
            getPaliModuleAddress(1, 'guardian-recovery'),
            '0x00',
          ])
        );
      if (scenario === 'trailing-uninstall') return single(data + '00');
      if (scenario === 'trailing-execute') return single(data) + '00';
      return paliSmartAccountInterface.encodeFunctionData('execute', [
        '0x' + '01' + '00'.repeat(31),
        account + '0'.repeat(64) + data.slice(2),
      ]);
    });
    const projected = decodeRetainedSmartAccountOperations({
      ...entry,
      metadata: { guardianRemoval: true },
    });
    assert.equal(projected.length, 1);
    assert.equal(projected[0]!.guardianRemoval, undefined);
  });

test('guardian removal cannot bypass the authenticated outer value or canonical envelope', async () => {
  const entry = await guardianRemovalEntry((data, single) => single(data));
  const original = Transaction.from(entry.rawTransaction);
  for (const change of [
    { value: 1, data: original.data },
    { value: 0, data: original.data + '00' },
  ]) {
    const rawTransaction = await payer.signTransaction({
      type: 0,
      chainId: 1,
      nonce: original.nonce,
      to: original.to,
      gasLimit: original.gasLimit,
      gasPrice: original.gasPrice,
      ...change,
    });
    assert.deepEqual(
      decodeRetainedSmartAccountOperations({
        ...entry,
        rawTransaction,
        hash: Transaction.from(rawTransaction).hash!,
      }),
      []
    );
  }
});
