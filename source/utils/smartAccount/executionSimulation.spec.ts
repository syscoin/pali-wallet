import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { captureSmartAccountCallsIdentity } from '../../shared/dappCallsStatus';

import { buildSmartAccountUserOperation } from './account';
import { paliEntryPointInterface } from './contracts';
import {
  assertSmartAccountExecutionSimulation,
  assertSignedSmartAccountExecution,
  recoverExecutionSimulationEnvelope,
} from './executionSimulation';

const payer = `0x${'11'.repeat(20)}`;
const sender = `0x${'22'.repeat(20)}`;
const operation = buildSmartAccountUserOperation({
  sender,
  nonce: '0',
  callData: '0x',
});
const identity = captureSmartAccountCallsIdentity(operation, 1);
const parent = { hash: `0x${'33'.repeat(32)}`, number: BigInt(10) };
const transaction = {
  chainId: '0x1',
  data: '0x1234',
  from: payer,
  gas: '0x30000',
  to: identity.entryPoint,
  type: '0x2' as const,
  value: '0x0',
  nonce: '0x1',
  maxFeePerGas: '0xa',
  maxPriorityFeePerGas: '0x1',
  accessList: [],
};
const operationEvent = { nonce: BigInt(0), paymaster: `0x${'00'.repeat(20)}` };
const log = (
  success: boolean,
  nonce = operationEvent.nonce,
  paymaster = operationEvent.paymaster
) => ({
  address: identity.entryPoint,
  ...paliEntryPointInterface.encodeEventLog(
    paliEntryPointInterface.getEvent('UserOperationEvent')!,
    [identity.userOpHash, sender, paymaster, nonce, success, 1, 1]
  ),
});
const makeBlock = (success: boolean) => ({
  parentHash: parent.hash,
  number: '0xb',
  transactions: [{ ...transaction, input: transaction.data }],
  calls: [{ status: '0x1', gasUsed: '0x12000', logs: [log(success)] }],
});

it('observes the exact payer and fee shape at the captured parent', async () => {
  const simulate = jest.fn(async () => [makeBlock(true)]);
  await assertSmartAccountExecutionSimulation({
    parent,
    identity,
    operationEvent,
    transactions: [transaction],
    assertCurrent: () => undefined,
    simulate,
  });
  expect(simulate).toHaveBeenCalledWith([
    {
      blockStateCalls: [{ calls: [transaction] }],
      traceTransfers: false,
      validation: true,
      returnFullTransactions: true,
    },
    '0xa',
  ]);
});

it.each([
  'inner revert',
  'rewritten fee cap',
  'wrong payer',
  'wrong event nonce',
  'wrong event paymaster',
  'wrong parent',
  'duplicate event',
  'outer over budget',
])('rejects %s before dispatch', async (failure) => {
  const block = makeBlock(failure !== 'inner revert');
  if (failure === 'rewritten fee cap')
    block.transactions[0]!.maxFeePerGas = '0x5';
  if (failure === 'wrong event nonce')
    block.calls[0]!.logs = [log(true, BigInt(2))];
  if (failure === 'wrong event paymaster')
    block.calls[0]!.logs = [log(true, BigInt(0), sender)];
  if (failure === 'wrong payer') block.transactions[0]!.from = sender;
  if (failure === 'wrong parent') block.parentHash = `0x${'aa'.repeat(32)}`;
  if (failure === 'duplicate event') block.calls[0]!.logs.push(log(true));
  if (failure === 'outer over budget') block.calls[0]!.gasUsed = '0x30001';
  await expect(
    assertSmartAccountExecutionSimulation({
      parent,
      identity,
      operationEvent,
      transactions: [transaction],
      assertCurrent: () => undefined,
      simulate: async () => [block],
    })
  ).rejects.toThrow('Unable to verify smart account execution');
});

it('uses only the final call event and requires every echoed predecessor', async () => {
  const block = makeBlock(false);
  const predecessor = { ...transaction, nonce: '0x0' };
  block.calls.unshift({ ...block.calls[0]!, logs: [log(true)] });
  block.transactions.unshift({ ...predecessor, input: predecessor.data });
  const run = () =>
    assertSmartAccountExecutionSimulation({
      parent,
      identity,
      operationEvent,
      transactions: [predecessor, transaction],
      assertCurrent: () => undefined,
      simulate: async () => [block],
    });
  await expect(run()).rejects.toThrow(
    'Unable to verify smart account execution'
  );
  block.calls[1]!.logs = [log(true)];
  await expect(run()).resolves.toBeUndefined();
  block.transactions.shift();
  await expect(run()).rejects.toThrow(
    'Unable to verify smart account execution'
  );
});

it('retires the result if the owning operation ends during simulation', async () => {
  let active = true;
  await expect(
    assertSmartAccountExecutionSimulation({
      parent,
      identity,
      operationEvent,
      transactions: [transaction],
      assertCurrent: () => {
        if (!active) throw new Error('cancelled');
      },
      simulate: async () => {
        active = false;
        return [makeBlock(true)];
      },
    })
  ).rejects.toThrow('cancelled');
});

it.each([0, 1, 2])(
  'reconstructs the signed type %s payer envelope',
  async (type) => {
    const signer = new Wallet(`0x${'11'.repeat(32)}`);
    const fees =
      type === 2
        ? { maxFeePerGas: '10', maxPriorityFeePerGas: '1' }
        : { gasPrice: '10' };
    const accessList =
      type === 0 ? undefined : [{ address: sender, storageKeys: [] }];
    const raw = await signer.signTransaction({
      type,
      chainId: 1,
      to: identity.entryPoint,
      nonce: 1,
      data: transaction.data,
      value: 0,
      gasLimit: transaction.gas,
      ...fees,
      accessList,
    });
    const signedHash = Transaction.from(raw).hash!;
    const envelope = recoverExecutionSimulationEnvelope(raw, signedHash);
    expect(envelope).toMatchObject({
      from: signer.address,
      chainId: transaction.chainId,
      to: expect.stringMatching(new RegExp(identity.entryPoint, 'i')),
      data: transaction.data,
      value: transaction.value,
      nonce: transaction.nonce,
      gas: transaction.gas,
      type: `0x${type}`,
      ...(type === 2
        ? { maxFeePerGas: '0xa', maxPriorityFeePerGas: '0x1' }
        : { gasPrice: '0xa' }),
    });
    expect(envelope.accessList).toEqual(accessList);
    expect(envelope).not.toHaveProperty('signature');
    expect(() => recoverExecutionSimulationEnvelope(raw, parent.hash)).toThrow(
      'Unable to verify smart account execution'
    );
  }
);

it('validates a retained signed payer transaction through one bounded final simulation', async () => {
  const signer = new Wallet(`0x${'11'.repeat(32)}`);
  const raw = await signer.signTransaction({
    type: 2,
    chainId: 1,
    to: identity.entryPoint,
    nonce: 0,
    data: transaction.data,
    gasLimit: transaction.gas,
    maxFeePerGas: 10,
    maxPriorityFeePerGas: 1,
  });
  const hash = Transaction.from(raw).hash!;
  const envelope = recoverExecutionSimulationEnvelope(raw, hash);
  const send = jest.fn(async (method: string) => {
    if (method === 'eth_getBlockByNumber')
      return { number: '0xa', hash: parent.hash };
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_simulateV1')
      return [
        {
          ...makeBlock(true),
          transactions: [{ ...envelope, input: envelope.data }],
        },
      ];
    throw new Error(method);
  });
  await assertSignedSmartAccountExecution(
    { send },
    raw,
    hash,
    operation,
    1,
    undefined,
    () => undefined
  );
  expect(
    send.mock.calls.filter(([method]) => method === 'eth_simulateV1')
  ).toHaveLength(1);
});

it('keeps a queued transaction behind its exact retained predecessor', async () => {
  const signer = new Wallet(`0x${'11'.repeat(32)}`);
  const sign = (nonce: number) =>
    signer.signTransaction({
      type: 2,
      chainId: 1,
      to: identity.entryPoint,
      nonce,
      data: transaction.data,
      gasLimit: transaction.gas,
      maxFeePerGas: 10,
      maxPriorityFeePerGas: 1,
    });
  const first = await sign(0),
    last = await sign(1);
  const firstHash = Transaction.from(first).hash!,
    lastHash = Transaction.from(last).hash!;
  const predecessor = recoverExecutionSimulationEnvelope(first, firstHash);
  const target = recoverExecutionSimulationEnvelope(last, lastHash);
  const retained = {
    chainId: '1',
    from: signer.address,
    hash: firstHash,
    nonce: 0,
    phase: 'submitted' as const,
  };
  let current = true;
  const send = jest.fn(async (method: string) => {
    if (method === 'eth_getBlockByNumber')
      return { number: '0xa', hash: parent.hash };
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getTransactionByHash')
      return {
        ...predecessor,
        input: predecessor.data,
        hash: firstHash,
        blockHash: null,
        blockNumber: null,
      };
    if (method === 'eth_simulateV1')
      return [
        {
          ...makeBlock(true),
          transactions: [predecessor, target].map((tx) => ({
            ...tx,
            input: tx.data,
          })),
          calls: [
            { status: '0x0', gasUsed: '0x1', logs: [] },
            ...makeBlock(true).calls,
          ],
        },
      ];
    throw Error(method);
  });
  const snapshot = {
    owner: 'test',
    minimumNonce: 0,
    retained: [retained],
    readMaximumCost: async () => BigInt(0),
    readAssetDebit: async () => BigInt(0),
    readSignedTransaction: async () => first,
  };
  await assertSignedSmartAccountExecution(
    { send },
    last,
    lastHash,
    operation,
    1,
    snapshot,
    () => {
      if (!current) throw Error('cancelled');
    }
  );
  expect(
    send.mock.calls.filter(([method]) => method === 'eth_simulateV1')
  ).toHaveLength(1);
  current = false;
  await expect(
    assertSignedSmartAccountExecution(
      { send },
      last,
      lastHash,
      operation,
      1,
      snapshot,
      () => {
        if (!current) throw Error('cancelled');
      }
    )
  ).rejects.toThrow('cancelled');
});
