import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction, Wallet } from 'ethers';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { projectSmartAccountSavedTransaction } from '../../../source/wallet/smartAccountSignedReplay.ts';
import { observeSmartAccountOperations } from '../../../source/wallet/smartAccountActivity.ts';
import { captureSmartAccountCancellation, smartAccountCancellationMetadata } from '../../../source/wallet/smartAccountCancellation.ts';
import { getSmartAccountUserOpHash } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { encodeERC7579Executions } from '../../../source/utils/smartAccount/account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../../../source/utils/smartAccount/contracts.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

const account = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const payer = new Wallet('0x' + '33'.repeat(32));
const blockHash = '0x' + '44'.repeat(32);
async function fixture() {
  let disk: string | undefined;
  let receipt: unknown = null;
  const calls: string[] = [];
  const session = signedRecordTestSession();
  const storage = {
    async read() {
      return disk;
    },
    async compareAndSet(
      _id: string,
      previous: string | undefined,
      next: string,
      check: () => void
    ) {
      check();
      if (disk !== previous) return false;
      disk = next;
      return true;
    },
  };
  const records = new EvmSignedRecords(storage, () => 1000);
  const context = {
    account: { id: 0, type: 'HDAccount', address: payer.address },
    network: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: 'https://offline.invalid',
    },
  };
  const read = async (method: string, _params: readonly unknown[] = []) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_getBlockByNumber')
      return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
    throw new Error(method);
  };
  const get = async (hash: string) => {
    const record = await records.readSmartAccountReplayExact(session, '1', account, hash);
    return record ? projectSmartAccountSavedTransaction(record, account) : null;
  };
  const list = async (options: { maximum: number; beforeHash?: string }) => {
    const page = await records.readSmartAccountReplayPage(session, '1', account, options);
    return { nextCursor: page.nextCursor, transactions: page.entries.map(record => projectSmartAccountSavedTransaction(record, account)) };
  };
  async function append(
    options: {
      nonce?: number;
      owner?: string;
      calls?: { target: string; value: string; data?: string }[];
      multi?: boolean | 'same';
      plain?: boolean;
      outerTo?: string;
      outerData?: string;
      outerDataSuffix?: string;
      metadata?: any;
    } = {}
  ) {
    const encoded = encodeERC7579Executions(
      options.calls ?? [{ target: recipient, value: '9' }]
    );
    const operation = {
      sender: options.owner ?? account,
      nonce: 7n,
      initCode: '0x',
      callData: paliSmartAccountInterface.encodeFunctionData('execute', [
        encoded.mode,
        encoded.executionCalldata,
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
      nonce: options.nonce ?? 0,
      type: 0,
      gasPrice: 2,
      gasLimit: 300000,
      value: 0,
      to:
        options.outerTo ??
        (options.plain ? recipient : getPaliEntryPointAddress(1)),
      data:
        options.outerData ??
        (options.plain
          ? '0x'
          : paliEntryPointInterface.encodeFunctionData('handleOps', [
              options.multi
                ? [operation, { ...operation, ...(options.multi === 'same' ? { nonce: 8n } : { sender: recipient }) }]
                : [operation],
              payer.address,
            ])) + (options.outerDataSuffix ?? ''),
    });
    const tx = Transaction.from(rawTransaction);
    const entry = await records.append(
      session,
      {
        rawTransaction,
        hash: tx.hash!,
        from: payer.address,
        chainId: '1',
        nonce: tx.nonce,
        type: 0,
        context: { ...context, operation: 'send' },
      },
      options.metadata
    );
    return { entry, operation };
  }
  return {
    get,
    context,
    list,
    read,
    records,
    session,
    append,
    calls,
    mined(value: any) {
      receipt = value;
    },
  };
}

for (const replaceOuter of [false, true])
  test(`saved Smart cancellation projects its own signed handleOps (replace outer: ${replaceOuter})`, async () => {
    const f = await fixture();
    const { entry: original, operation } = await f.append();
    const cancellation = captureSmartAccountCancellation({
      account,
      chainId: 1,
      referenceHash: original.hash,
      outer: original,
      observedAt: { number: '16', hash: blockHash },
    });
    const noop = encodeERC7579Executions([{ target: account, value: '0' }]);
    const userOperation = {
      ...operation,
      nonce: operation.nonce.toString(),
      preVerificationGas: operation.preVerificationGas.toString(),
      callData: paliSmartAccountInterface.encodeFunctionData('execute', [
        noop.mode,
        noop.executionCalldata,
      ]),
    };
    const operationHash = getSmartAccountUserOpHash(userOperation, 1);
    const binding = replaceOuter
      ? await f.records.captureSmartAccountCancellationReplacement(f.session, {
          chainId: 1,
          newUserOperation: userOperation,
          originalHash: original.hash,
          payer: payer.address,
        })
      : undefined;
    const nonce = replaceOuter ? original.nonce : original.nonce + 1;
    const rawTransaction = await payer.signTransaction({
      chainId: 1,
      nonce,
      type: 0,
      gasPrice: 4,
      gasLimit: 300000,
      to: getPaliEntryPointAddress(1),
      data: paliEntryPointInterface.encodeFunctionData('handleOps', [
        [userOperation],
        payer.address,
      ]),
    });
    const hash = Transaction.from(rawTransaction).hash!;
    await f.records.append(
      f.session,
      {
        rawTransaction,
        hash,
        from: payer.address,
        chainId: '1',
        nonce,
        type: 0,
        context: { ...f.context, operation: 'send' },
      },
      {
        smartAccountOperationCancellation: smartAccountCancellationMetadata(
          cancellation,
          operationHash
        ),
      },
      binding
    );
    const transaction = await f.get(hash);
    assert(transaction);
    assert.equal(transaction.operation, 'send');
    assert.equal(transaction.originalHash, replaceOuter ? original.hash : undefined);
    assert.equal(transaction.smartAccount.cancellation, true);
    assert.equal(transaction.smartAccount.operationHash, operationHash);
    assert.deepEqual(transaction.smartAccount.executions, [
      { target: account, value: '0', data: '0x' },
    ]);
    assert.equal(transaction.smartAccount.transfer, undefined);
    assert.deepEqual((await f.list({ maximum: 20 })).transactions, [transaction]);

    assert.equal(transaction.nonce, nonce);
    assert.equal(transaction.smartAccount.operationNonce, operation.nonce.toString());
  });

test('an ordinary saved Smart zero-value self-call has no cancellation intent', async () => {
  const f = await fixture();
  const { entry } = await f.append({
    calls: [{ target: account, value: '0' }],
  });
  assert.equal((await f.get(entry.hash))?.smartAccount.cancellation, undefined);
});

test('general signed handleOps lookup does not depend on metadata or transfer-shaped calls', async () => {
  const f = await fixture();
  const { entry } = await f.append({
    calls: [{ target: account, value: '0', data: '0x12345678' }],
    metadata: {
      smartAccountExecution: true,
      smartAccountExecutionFrom: recipient,
    },
  });
  const item = await f.get(entry.hash);
  assert(item);
  assert.equal(item.smartAccount.executions?.[0]?.data, '0x12345678');
  assert.equal(item.smartAccount.transfer?.contractInteraction, true);
  assert.equal(
    await f.records.readSmartAccountReplayExact(
      f.session,
      '1',
      recipient,
      entry.hash
    ),
    null
  );
});

test('inner batch calls retain separate execution intent and raw token arguments', async () => {
  const f = await fixture(),
    { entry } = await f.append({
      calls: [
        { target: recipient, value: '9' },
        {
          target: account,
          value: '0',
          data: encodeErc20Transfer(recipient, '12'),
        },
      ],
    });
  const item = await f.get(entry.hash);
  assert(item);
  assert.equal(item.smartAccount.replayable, true);
  assert.equal(item.smartAccount.executions?.length, 2);
  assert.equal(
    item.smartAccount.executions?.[1]?.assetTransfer?.recipient,
    recipient
  );
  assert.equal(
    item.smartAccount.executions?.[1]?.assetTransfer?.items[0]?.units,
    '12'
  );
  assert.equal(item.smartAccount.transfer, undefined);
});

for (const mode of ['all-true', 'second-false', 'second-missing', 'second-wrong', 'duplicate'] as const)
  test(`native same-account multi-operation observation requires every event: ${mode}`, async () => {
    const f = await fixture(), { entry } = await f.append({ multi: 'same' });
    const saved = await f.get(entry.hash); assert(saved);
    assert.equal(saved.smartAccount.operations.length, 2);
    const view = createNativeSignedRecordView(f.records, f.session, '66'.repeat(32),
      { index: 0, type: 'SmartAccount', address: account }, getNativeNetwork('ethereum'));
    const row = await view.smartActivity(entry.hash); assert(row?.smartAccount);
    assert.equal(row.smartAccount.operations.length, 2);
    const logs = row.smartAccount.operations.flatMap((operation, index) => {
      if (mode === 'second-missing' && index === 1) return [];
      const event = paliEntryPointInterface.encodeEventLog(paliEntryPointInterface.getEvent('UserOperationEvent')!, [
        mode === 'second-wrong' && index === 1 ? blockHash : operation.operationHash,
        account, '0x' + '00'.repeat(20), operation.operationNonce,
        !(mode === 'second-false' && index === 1), 1, 1,
      ]);
      const log = { ...event, address: getPaliEntryPointAddress(1), transactionHash: entry.hash, blockHash, blockNumber: '0x10' };
      return mode === 'duplicate' && index === 1 ? [log, log] : [log];
    });
    f.mined({ transactionHash: entry.hash, from: payer.address, to: getPaliEntryPointAddress(1),
      status: '0x1', blockNumber: '0x10', blockHash, logs });
    f.calls.length = 0;
    const observing = observeSmartAccountOperations({ chainId: '1', hash: entry.hash, account, nonce: row.nonce, ...row.smartAccount }, f.read, () => undefined);
    if (mode === 'all-true' || mode === 'second-false') {
      const observed = await observing;
      assert.equal(observed.status === 'mined' && observed.outcome, mode === 'all-true' ? 'confirmed' : 'reverted');
    } else await assert.rejects(observing, /outcome unavailable/);
    assert.equal(f.calls.filter(method => method === 'eth_getTransactionReceipt').length, 1);
    assert.equal(f.calls.filter(method => method === 'eth_getBlockByNumber').length, 1);
  });

test('aggregate Smart observation refuses duplicate or unbounded identities before any read', async () => {
  const f = await fixture(), { entry } = await f.append();
  const saved = await f.get(entry.hash); assert(saved);
  const identity = saved.smartAccount.operations[0]!;
  for (const operations of [[identity, identity], Array.from({ length: 513 }, () => identity)]) {
    f.calls.length = 0;
    await assert.rejects(observeSmartAccountOperations({ account, chainId: '1', hash: entry.hash, nonce: 0,
      payer: payer.address, operations }, f.read, () => undefined));
    assert.equal(f.calls.length, 0);
  }
});

test('wrong Smart Account records are excluded and pagination follows matching signed operations', async () => {
  const f = await fixture(),
    first = await f.append();
  const foreign = await f.append({ nonce: 1, owner: recipient });
  const last = await f.append({ nonce: 2 });
  assert.equal(await f.get(foreign.entry.hash), null);
  const page = await f.list({ maximum: 1 });
  assert.equal(page.transactions[0]?.hash, last.entry.hash);
  assert.equal(page.nextCursor, last.entry.hash);
  const older = await f.list({
    maximum: 1,
    beforeHash: page.nextCursor!,
  });
  assert.equal(older.transactions[0]?.hash, first.entry.hash);
  assert.equal(older.nextCursor, null);
});

test('native Activity discovers missing-metadata transfers, administration and inner batches through the same authenticated page', async () => {
  const f = await fixture();
  const transfer = await f.append();
  const admin = await f.append({
    nonce: 1,
    calls: [{ target: account, value: '0', data: '0x12345678' }],
  });
  const batch = await f.append({
    nonce: 2,
    calls: [
      { target: recipient, value: '1' },
      { target: account, value: '2' },
    ],
  });
  const view = createNativeSignedRecordView(
    f.records,
    f.session,
    '66'.repeat(32),
    { index: 0, type: 'SmartAccount', address: account },
    getNativeNetwork('ethereum')
  );
  const page = await view.pendingActivities();
  assert.deepEqual(
    page.records.map((row) => row.hash),
    [batch.entry.hash, admin.entry.hash, transfer.entry.hash]
  );
  assert.equal(page.records[0]!.contractInteraction, true);
  assert.equal(page.records[0]!.amountUnits, '0');
  assert.equal(page.records[1]!.contractInteraction, true);
  assert.equal(page.records[2]!.recipient, recipient);
  assert.equal(page.records[2]!.amountUnits, '9');
  assert.equal(page.records[2]!.inspectionOnly, undefined);
  assert.equal(page.records[2]!.maximumFeeUnits, '600000');
  assert.equal(
    (await view.smartActivity(batch.entry.hash))!.smartAccount?.payer,
    payer.address
  );
});

test('native Activity retains an authenticated Smart cancellation through its original operation', async () => {
  const f = await fixture(),
    { entry } = await f.append({
      metadata: {
        smartAccountExecution: true,
        smartAccountExecutionFrom: account,
      },
    });
  const raw = await payer.signTransaction({
    chainId: 1,
    nonce: 0,
    type: 0,
    gasPrice: 3,
    gasLimit: 42000,
    value: 0,
    to: payer.address,
    data: '0x',
  });
  const tx = Transaction.from(raw);
  const binding = await f.records.captureVerifiedReplacement(f.session, {
    chainId: '1',
    from: payer.address,
    nonce: 0,
    operation: 'cancel',
    originalHash: entry.hash,
  });
  await f.records.append(
    f.session,
    {
      rawTransaction: raw,
      hash: tx.hash!,
      from: payer.address,
      chainId: '1',
      nonce: 0,
      type: 0,
      context: {
        account: { id: 0, type: 'HDAccount', address: payer.address },
        network: {
          kind: 'ethereum',
          chainId: 1,
          slip44: 60,
          url: 'https://offline.invalid',
        },
        operation: 'cancel',
        originalHash: entry.hash,
      },
    },
    { smartAccountExecution: true, smartAccountExecutionFrom: account },
    binding
  );
  const view = createNativeSignedRecordView(
    f.records,
    f.session,
    '66'.repeat(32),
    { index: 0, type: 'SmartAccount', address: account },
    getNativeNetwork('ethereum')
  );
  const page = await view.pendingActivities();
  assert.equal(page.records[0]!.hash, tx.hash);
  assert.equal(page.records[0]!.smartAccount?.cancellation, true);
  const saved = await f.get(tx.hash!);
  assert.equal(saved?.smartAccount.cancellation, true);
});
