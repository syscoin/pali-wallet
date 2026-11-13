import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction, Wallet } from 'ethers';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { createSmartAccountSignedReplay } from '../../../source/wallet/smartAccountSignedReplay.ts';
import { observeSmartAccountOperations } from '../../../source/wallet/smartAccountActivity.ts';
import { observeEvmTransaction } from '../../../source/shared/evmTransactionObservation.ts';
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
  let disk: string | undefined,
    epoch = 0,
    selected = account,
    clock = 10;
  let payerChanged = false,
    wrongPayer = false,
    rpcFailed = false,
    receipt: any = null;
  let beforeRead: (() => Promise<void>) | undefined;
  const dispatched: string[] = [],
    calls: string[] = [];
  const session = signedRecordTestSession();
  const storage = {
    async read() {
      await beforeRead?.();
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
  const read = async (method: string) => {
    calls.push(method);
    if (rpcFailed) throw new Error('RPC unavailable');
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_getBlockByNumber')
      return { number: '0x10', hash: blockHash, gasLimit: '0x100000' };
    throw new Error(method);
  };
  const replay = createSmartAccountSignedReplay(
    records,
    () => {
      const captured = epoch,
        address = selected;
      const check = () => {
        if (captured !== epoch || selected !== address)
          throw new Error('Owner changed');
      };
      return {
        account: { id: 0, address },
        chainId: '1',
        recordSession: { ...session, assertCurrent: check },
        assertCurrent: check,
        read: async (method, _params, current) => {
          current();
          return read(method);
        },
        capturePayer: () => ({
          context: wrongPayer
            ? { ...context, account: { ...context.account, id: 1 } }
            : context,
          recordSession: session,
          assertCurrent() {
            check();
            if (payerChanged) throw new Error('Payer changed');
          },
          observe: (expected) => observeEvmTransaction(expected, read, check),
          async authorizeReplay() {
            return {
              assertCurrent: check,
              onAcknowledged: async () => undefined,
              withAdmission: async (admit) => admit(),
            };
          },
          async dispatch(bytes, admit) {
            return admit(
              async () => {
                dispatched.push(bytes);
                return Transaction.from(bytes).hash!;
              },
              async () => {
                check();
              }
            );
          },
        }),
      };
    },
    () => clock,
    (size) => new Uint8Array(size).fill(7)
  );
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
    replay,
    read,
    records,
    session,
    append,
    dispatched,
    calls,
    wrongPayer() {
      wrongPayer = true;
    },
    payerChanged() {
      payerChanged = true;
    },
    rpcFailed() {
      rpcFailed = true;
    },
    expire() {
      clock += 90001;
    },
    switchAwayAndBack() {
      selected = recipient;
      epoch++;
      selected = account;
      epoch++;
    },
    beforeRead(callback: () => Promise<void>) {
      beforeRead = callback;
    },
    mined(value: any) {
      receipt = value;
    },
  };
}

test('missing receipt exposes inner intent and resends only the exact retained outer bytes', async () => {
  const f = await fixture(),
    { entry } = await f.append();
  const page = await f.replay.list();
  assert.equal(page.transactions.length, 1);
  const saved = page.transactions[0]!;
  assert.equal(saved.from.toLowerCase(), payer.address.toLowerCase());
  assert.equal(saved.to, getPaliEntryPointAddress(1));
  assert.equal(saved.value, '0');
  assert.equal(saved.smartAccount.transfer?.recipient, recipient);
  assert.equal(saved.smartAccount.transfer?.amountUnits, '9');
  assert.equal(saved.smartAccount.operationNonce, '7');
  assert.equal(saved.nonce, 0);
  const prepared = await f.replay.prepare(entry.hash);
  assert.equal(prepared.status, 'review');
  if (prepared.status !== 'review') assert.fail();
  assert.equal(prepared.review.smartAccount.account, account);
  assert.equal(prepared.review.to, getPaliEntryPointAddress(1));
  assert.deepEqual(await f.replay.confirm(prepared.review.id), {
    hash: entry.hash,
    status: 'submitted',
  });
  assert.deepEqual(f.dispatched, [entry.rawTransaction]);
  assert.equal(
    (await f.records.readExact(f.session, '1', payer.address, entry.hash))
      ?.rawTransaction,
    entry.rawTransaction
  );
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
  const item = await f.replay.get(entry.hash);
  assert(item);
  assert.equal(item.smartAccount.executions?.[0]?.data, '0x12345678');
  assert.equal(item.smartAccount.transfer?.contractInteraction, true);
  assert.equal((await f.replay.prepare(entry.hash)).status, 'review');
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
  const item = await f.replay.get(entry.hash);
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
  assert.equal((await f.replay.prepare(entry.hash)).status, 'review');
});

test('multiple outer UserOperations remain inspect-only', async () => {
  const f = await fixture(),
    { entry } = await f.append({ multi: true });
  const prepared = await f.replay.prepare(entry.hash);
  assert.equal(prepared.status, 'inspect-only');
  if (prepared.status !== 'inspect-only') assert.fail();
  assert.equal(prepared.transaction.smartAccount.operationCount, 2);
  assert.throws(() => f.replay.confirm('none'), { code: 'EXPIRED' });
  assert.equal(f.dispatched.length, 0);
});

for (const mode of ['all-true', 'second-false', 'second-missing', 'second-wrong', 'duplicate'] as const)
  test(`native same-account multi-operation observation requires every event: ${mode}`, async () => {
    const f = await fixture(), { entry } = await f.append({ multi: 'same' });
    const saved = await f.replay.get(entry.hash); assert(saved);
    assert.equal(saved.smartAccount.operations.length, 2);
    assert.equal((await f.replay.prepare(entry.hash)).status, 'inspect-only');
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
  const saved = await f.replay.get(entry.hash); assert(saved);
  const identity = saved.smartAccount.operations[0]!;
  for (const operations of [[identity, identity], Array.from({ length: 513 }, () => identity)]) {
    f.calls.length = 0;
    await assert.rejects(observeSmartAccountOperations({ account, chainId: '1', hash: entry.hash, nonce: 0,
      payer: payer.address, operations }, f.read, () => undefined));
    assert.equal(f.calls.length, 0);
  }
});

test('wrong recorded payer, expired consent, and changed selected owner prevent replay', async () => {
  for (const mode of ['payer', 'changed', 'expired', 'aba']) {
    const f = await fixture(),
      { entry } = await f.append();
    if (mode === 'payer') {
      f.wrongPayer();
      await assert.rejects(f.replay.prepare(entry.hash));
    } else {
      const prepared = await f.replay.prepare(entry.hash);
      if (prepared.status !== 'review') assert.fail();
      if (mode === 'changed') f.payerChanged();
      else if (mode === 'expired') f.expire();
      else f.switchAwayAndBack();
      await assert.rejects(f.replay.confirm(prepared.review.id));
    }
    assert.equal(f.dispatched.length, 0);
  }
});

test('RPC failure retains recoverable bytes and does not dispatch', async () => {
  const f = await fixture(),
    { entry } = await f.append();
  f.rpcFailed();
  await assert.rejects(f.replay.prepare(entry.hash));
  assert.equal(f.dispatched.length, 0);
  assert.equal(
    (await f.records.readExact(f.session, '1', payer.address, entry.hash))
      ?.rawTransaction,
    entry.rawTransaction
  );
});

test('wrong Smart Account records are excluded and pagination follows matching signed operations', async () => {
  const f = await fixture(),
    first = await f.append();
  const foreign = await f.append({ nonce: 1, owner: recipient });
  const last = await f.append({ nonce: 2 });
  assert.equal(await f.replay.get(foreign.entry.hash), null);
  await assert.rejects(f.replay.prepare(foreign.entry.hash), {
    code: 'NOT_FOUND',
  });
  const page = await f.replay.list({ maximum: 1 });
  assert.equal(page.transactions[0]?.hash, last.entry.hash);
  assert.equal(page.nextCursor, last.entry.hash);
  const older = await f.replay.list({
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
  const saved = await f.replay.get(tx.hash!);
  assert.equal(saved?.smartAccount.cancellation, true);
  const prepared = await f.replay.prepare(tx.hash!);
  assert.equal(prepared.status, 'review');
  if (prepared.status !== 'review') assert.fail();
  assert.equal(prepared.review.to, payer.address);
});

test('owner change while the encrypted record is loading rejects the late result', async () => {
  const f = await fixture(),
    { entry } = await f.append();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.beforeRead(async () => {
    entered();
    await paused;
  });
  const pending = f.replay.prepare(entry.hash);
  const rejected = assert.rejects(pending);
  await started;
  f.switchAwayAndBack();
  release();
  await rejected;
  assert.equal(f.dispatched.length, 0);
});

test('the existing replay engine consumes confirmation once', async () => {
  const f = await fixture(),
    { entry } = await f.append();
  const prepared = await f.replay.prepare(entry.hash);
  if (prepared.status !== 'review') assert.fail();
  const first = f.replay.confirm(prepared.review.id);
  await assert.rejects(f.replay.confirm(prepared.review.id), {
    code: 'EXPIRED',
  });
  await first;
  assert.deepEqual(f.dispatched, [entry.rawTransaction]);
});

test('an explicit missing-nonce predecessor keeps selected Smart authority and replays its original payer bytes', async () => {
  const f = await fixture(),
    first = await f.append({ plain: true }),
    second = await f.append({ nonce: 1 });
  const parent = await f.replay.prepare(second.entry.hash);
  assert.equal(parent.status, 'review');
  if (parent.status !== 'review') assert.fail();
  assert.equal(parent.review.missingNonce, '0');
  assert.equal(parent.review.predecessors[0]?.hash, first.entry.hash);
  const page = await f.replay.listPredecessors(parent.review.id, {
    maximum: 1,
  });
  assert.equal(page.transactions[0]?.hash, first.entry.hash);
  await assert.rejects(
    f.replay.preparePredecessor(parent.review.id, second.entry.hash),
    /NOT_FOUND/
  );
  const prior = await f.replay.preparePredecessor(
    parent.review.id,
    first.entry.hash
  );
  assert.equal(prior.status, 'review');
  if (prior.status !== 'review') assert.fail();
  assert.equal(prior.review.to, recipient);
  assert.equal('smartAccount' in prior.review, false);
  await assert.rejects(
    f.replay.preparePredecessor(parent.review.id, first.entry.hash),
    /EXPIRED/
  );
  await f.replay.confirm(prior.review.id);
  assert.deepEqual(f.dispatched, [first.entry.rawTransaction]);
});

test('expired or changed Smart authority cannot open a previously offered payer predecessor', async () => {
  for (const revoke of ['expire', 'switchAwayAndBack'] as const) {
    const f = await fixture(),
      first = await f.append({ plain: true }),
      second = await f.append({ nonce: 1 });
    const parent = await f.replay.prepare(second.entry.hash);
    if (parent.status !== 'review') assert.fail();
    f[revoke]();
    await assert.rejects(
      f.replay.preparePredecessor(parent.review.id, first.entry.hash)
    );
    assert.equal(f.dispatched.length, 0);
  }
});

test('a multiple-UserOperation predecessor remains inspect-only after its parent offers nonce recovery', async () => {
  const f = await fixture(),
    first = await f.append({ multi: true }),
    second = await f.append({ nonce: 1 });
  const parent = await f.replay.prepare(second.entry.hash);
  if (parent.status !== 'review') assert.fail();
  const prior = await f.replay.preparePredecessor(
    parent.review.id,
    first.entry.hash
  );
  assert.equal(prior.status, 'inspect-only');
  if (prior.status !== 'inspect-only') assert.fail();
  assert.equal(prior.transaction.smartAccount.operationCount, 2);
  assert.equal(prior.transaction.smartAccount.replayable, false);
  await assert.rejects(f.replay.confirm(parent.review.id), { code: 'EXPIRED' });
  assert.equal(f.dispatched.length, 0);
});

test('known EntryPoint handleOps predecessors cannot bypass classification with trailing or malformed data', async () => {
  for (const malformed of [
    { outerDataSuffix: '00' },
    { outerData: paliEntryPointInterface.getFunction('handleOps')!.selector },
  ]) {
    const f = await fixture(),
      first = await f.append({ multi: true, ...malformed }),
      second = await f.append({ nonce: 1 });
    const parent = await f.replay.prepare(second.entry.hash);
    if (parent.status !== 'review') assert.fail();
    await assert.rejects(
      f.replay.preparePredecessor(parent.review.id, first.entry.hash),
      { code: 'INVALID_RESPONSE' }
    );
    assert.equal(
      (
        await f.records.readExact(
          f.session,
          '1',
          payer.address,
          first.entry.hash
        )
      )?.rawTransaction,
      first.entry.rawTransaction
    );
    assert.equal(f.dispatched.length, 0);
  }
});

test('a matching selector at an unrelated contract retains ordinary predecessor review', async () => {
  const f = await fixture(),
    first = await f.append({
      outerTo: recipient,
      outerData: paliEntryPointInterface.getFunction('handleOps')!.selector,
    }),
    second = await f.append({ nonce: 1 });
  const parent = await f.replay.prepare(second.entry.hash);
  if (parent.status !== 'review') assert.fail();
  const prior = await f.replay.preparePredecessor(
    parent.review.id,
    first.entry.hash
  );
  if (prior.status !== 'review') assert.fail();
  assert.equal('smartAccount' in prior.review, false);
  assert.equal(prior.review.to, recipient);
  await f.replay.confirm(prior.review.id);
  assert.deepEqual(f.dispatched, [first.entry.rawTransaction]);
});

test('a different Smart predecessor exposes its inner batch and native value alongside asset calldata', async () => {
  const f = await fixture(),
    otherAccount = '0x5555555555555555555555555555555555555555';
  const first = await f.append({
      owner: otherAccount,
      calls: [
        { target: recipient, value: '2' },
        {
          target: account,
          value: '3',
          data: encodeErc20Transfer(recipient, '11'),
        },
      ],
    }),
    second = await f.append({ nonce: 1 });
  const parent = await f.replay.prepare(second.entry.hash);
  if (parent.status !== 'review') assert.fail();
  const prior = await f.replay.preparePredecessor(
    parent.review.id,
    first.entry.hash
  );
  if (prior.status !== 'review' || !('smartAccount' in prior.review))
    assert.fail();
  assert.equal(prior.review.smartAccount.account, otherAccount);
  assert.equal(prior.review.smartAccount.executions?.length, 2);
  const payable = prior.review.smartAccount.executions![1]!;
  assert.equal(payable.value, '3');
  assert.equal(payable.assetTransfer?.recipient, recipient);
  assert.equal(payable.assetTransfer?.items[0]?.units, '11');
  assert.equal(payable.assetTransfer?.standardVerified, false);
  assert.equal(prior.review.from.toLowerCase(), payer.address.toLowerCase());
  assert.equal(prior.review.to, getPaliEntryPointAddress(1));
  await f.replay.confirm(prior.review.id);
  assert.deepEqual(f.dispatched, [first.entry.rawTransaction]);
});

test('a Smart predecessor uses its inner receipt outcome while retaining the original selected-owner guard', async () => {
  for (const outcome of ['reverted', 'owner-changed'] as const) {
    const f = await fixture(),
      otherAccount = '0x5555555555555555555555555555555555555555';
    const first = await f.append({ owner: otherAccount }),
      second = await f.append({ nonce: 1 });
    const parent = await f.replay.prepare(second.entry.hash);
    if (parent.status !== 'review') assert.fail();
    if (outcome === 'reverted') {
      const decoded = await f.records.readSmartAccountReplayExact(
        f.session,
        '1',
        otherAccount,
        first.entry.hash
      );
      assert(decoded);
      const event = paliEntryPointInterface.encodeEventLog(
        paliEntryPointInterface.getEvent('UserOperationEvent')!,
        [
          decoded.operations[0]!.operationHash,
          otherAccount,
          '0x' + '00'.repeat(20),
          7,
          false,
          100,
          50,
        ]
      );
      f.mined({
        transactionHash: first.entry.hash,
        from: payer.address,
        to: getPaliEntryPointAddress(1),
        status: '0x1',
        blockNumber: '0x10',
        blockHash,
        logs: [
          {
            ...event,
            address: getPaliEntryPointAddress(1),
            transactionHash: first.entry.hash,
            blockHash,
            blockNumber: '0x10',
          },
        ],
      });
      assert.equal(
        (await f.replay.preparePredecessor(parent.review.id, first.entry.hash))
          .status,
        'reverted'
      );
    } else {
      const prior = await f.replay.preparePredecessor(
        parent.review.id,
        first.entry.hash
      );
      if (prior.status !== 'review') assert.fail();
      f.switchAwayAndBack();
      await assert.rejects(f.replay.confirm(prior.review.id));
    }
    assert.equal(f.dispatched.length, 0);
  }
});

test('canonical outer revert is terminal without requiring a UserOperation success event', async () => {
  const f = await fixture(),
    { entry } = await f.append();
  f.mined({
    transactionHash: entry.hash,
    from: payer.address,
    to: getPaliEntryPointAddress(1),
    status: '0x0',
    blockNumber: '0x10',
    blockHash,
    logs: [],
  });
  assert.equal((await f.replay.prepare(entry.hash)).status, 'reverted');
  assert.equal(f.dispatched.length, 0);
});

for (const success of [true, false])
  test(`canonical inner outcome is ${
    success ? 'confirmed' : 'reverted'
  }`, async () => {
    const f = await fixture(),
      { entry } = await f.append(),
      saved = await f.replay.get(entry.hash);
    assert(saved);
    const event = paliEntryPointInterface.encodeEventLog(
      paliEntryPointInterface.getEvent('UserOperationEvent')!,
      [
        saved.smartAccount.operationHash,
        account,
        '0x' + '00'.repeat(20),
        7,
        success,
        100,
        50,
      ]
    );
    f.mined({
      transactionHash: entry.hash,
      from: payer.address,
      to: getPaliEntryPointAddress(1),
      status: '0x1',
      blockNumber: '0x10',
      blockHash,
      logs: [
        {
          ...event,
          address: getPaliEntryPointAddress(1),
          transactionHash: entry.hash,
          blockHash,
          blockNumber: '0x10',
        },
      ],
    });
    assert.equal(
      (await f.replay.prepare(entry.hash)).status,
      success ? 'confirmed' : 'reverted'
    );
    assert.equal(f.dispatched.length, 0);
  });
