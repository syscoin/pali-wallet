import { snapshotEvmAccessList } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import { captureSmartAccountCallsIdentity } from '../../shared/dappCallsStatus.ts';
import {
  getSmartAccountCallsOutcome,
  type SmartAccountCallsIdentity,
} from '../../shared/dappCallsStatus.ts';
import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { verifyEvmCanonicalBlock } from '../../shared/evmReadPhase.ts';
import {
  readEvmRpcHash,
  readEvmRpcQuantity,
} from '../../shared/evmTransactionObservation.ts';

import type { SmartAccountPackedUserOperation } from './account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
import { normalizeExecutionSimulationError } from './executionSimulationError.ts';
import type { EvmAutoNonceSnapshot } from '../../shared/evmAutoNonce.ts';

type RpcTransaction = Readonly<
  Record<string, unknown> & {
    chainId: string;
    data: string;
    from: string;
    gas: string;
    to?: string;
    type: '0x0' | '0x1' | '0x2';
  }
>;

type SimulationBlock = Readonly<{
  hash: string;
  number: bigint;
}>;

const requireExecutionEvidence = () =>
  new Error('Unable to verify smart account execution');

const quantity = (value: number | bigint) => `0x${BigInt(value).toString(16)}`;

/** Recover the signed execution fields locally. Only this projection leaves the wallet. */
export function recoverExecutionSimulationEnvelope(
  raw: string,
  expectedHash: string
): RpcTransaction {
  const transaction = Transaction.from(raw);
  if (
    !transaction.isSigned() ||
    readEvmRpcHash(transaction.hash) !== readEvmRpcHash(expectedHash) ||
    (transaction.type !== 0 && transaction.type !== 1 && transaction.type !== 2)
  )
    throw requireExecutionEvidence();

  const common = {
    from: transaction.from,
    ...(transaction.to === null ? {} : { to: transaction.to }),
    data: transaction.data,
    chainId: quantity(transaction.chainId),
    gas: quantity(transaction.gasLimit),
    nonce: quantity(transaction.nonce),
    value: quantity(transaction.value),
  };
  if (transaction.type === 2) {
    if (
      transaction.maxFeePerGas === null ||
      transaction.maxPriorityFeePerGas === null
    )
      throw requireExecutionEvidence();
    return {
      ...common,
      type: '0x2',
      maxFeePerGas: quantity(transaction.maxFeePerGas),
      maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas),
      accessList: transaction.accessList ?? [],
    };
  }
  if (transaction.gasPrice === null) throw requireExecutionEvidence();
  const gasPrice = quantity(transaction.gasPrice);
  return transaction.type === 0
    ? { ...common, type: '0x0', gasPrice }
    : {
        ...common,
        type: '0x1',
        gasPrice,
        accessList: transaction.accessList ?? [],
      };
}

function echoMatches(expected: RpcTransaction, actual: any): boolean {
  const quantities = [
    'chainId',
    'gas',
    'nonce',
    'type',
    'value',
    ...(expected.type === '0x2'
      ? ['maxFeePerGas', 'maxPriorityFeePerGas']
      : ['gasPrice']),
  ];
  if (
    !actual ||
    quantities.some(
      (field) =>
        readEvmRpcQuantity(expected[field]) !==
        readEvmRpcQuantity(actual[field])
    ) ||
    getAddress(expected.from) !== getAddress(actual.from) ||
    (expected.to === undefined
      ? actual.to !== null
      : getAddress(expected.to) !== getAddress(actual.to)) ||
    expected.data.toLowerCase() !== actual.input?.toLowerCase()
  )
    return false;
  if (expected.type === '0x0') return true;
  const normalize = (input: unknown) =>
    snapshotEvmAccessList(input).map(({ address, storageKeys }) => [
      address.toLowerCase(),
      storageKeys.map((key) => key.toLowerCase()),
    ]);
  return (
    JSON.stringify(normalize(expected.accessList)) ===
    JSON.stringify(normalize(actual.accessList))
  );
}

/** Confirm the last call's EntryPoint outcome in the same simulated block as its exact predecessors. */
export async function assertSmartAccountExecutionSimulation(
  input: Readonly<{
    assertCurrent: () => void;
    identity: SmartAccountCallsIdentity;
    operationEvent: Readonly<{ nonce: bigint; paymaster: string }>;
    parent: SimulationBlock;
    simulate(params: readonly unknown[]): Promise<unknown>;
    transactions: readonly RpcTransaction[];
  }>
) {
  const {
    assertCurrent,
    identity,
    operationEvent,
    parent,
    transactions,
    simulate,
  } = input;
  assertSynchronousEvmFeeGuard(assertCurrent);
  const target = transactions[transactions.length - 1];
  if (!target) throw requireExecutionEvidence();
  if (
    target.to?.toLowerCase() !== identity.entryPoint ||
    readEvmRpcQuantity(target.chainId) !== BigInt(identity.chainId)
  )
    throw requireExecutionEvidence();

  let result: unknown;
  try {
    result = await simulate([
      {
        blockStateCalls: [{ calls: transactions }],
        validation: true,
        returnFullTransactions: true,
        traceTransfers: false,
      },
      `0x${parent.number.toString(16)}`,
    ]);
  } catch (error) {
    assertSynchronousEvmFeeGuard(assertCurrent);
    throw normalizeExecutionSimulationError(error);
  }
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (!Array.isArray(result) || result.length !== 1)
    throw requireExecutionEvidence();
  const [block] = result;
  if (
    readEvmRpcHash(block?.parentHash) !== readEvmRpcHash(parent.hash) ||
    readEvmRpcQuantity(block?.number) !== parent.number + BigInt(1) ||
    !Array.isArray(block?.transactions) ||
    !Array.isArray(block.calls) ||
    block.transactions.length !== transactions.length ||
    block.calls.length !== transactions.length ||
    transactions.some(
      (transaction, index) =>
        !echoMatches(transaction, block.transactions[index])
    )
  )
    throw requireExecutionEvidence();
  const call = block.calls[transactions.length - 1];
  if (
    readEvmRpcQuantity(call?.status) !== BigInt(1) ||
    readEvmRpcQuantity(call?.gasUsed) > readEvmRpcQuantity(target.gas) ||
    getSmartAccountCallsOutcome(
      identity,
      identity.chainId,
      [{ status: 1, logs: call.logs }],
      operationEvent
    ) !== true
  )
    throw requireExecutionEvidence();
}

/** Check the actual signed execution after storage using the caller's fresh read phase. */
export async function assertSignedSmartAccountExecution(
  provider: {
    send(method: string, params: unknown[]): Promise<any>;
    sendFresh?(method: string, params: unknown[]): Promise<any>;
  },
  rawTransaction: string,
  hash: string,
  operation: SmartAccountPackedUserOperation,
  chainId: number,
  snapshot: EvmAutoNonceSnapshot | undefined,
  assertCurrent: () => void
) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const target = recoverExecutionSimulationEnvelope(rawTransaction, hash);
  const parent = await provider.send('eth_getBlockByNumber', ['latest', false]);
  assertSynchronousEvmFeeGuard(assertCurrent);
  const parentNumber = readEvmRpcQuantity(parent?.number);
  const firstNonce = readEvmRpcQuantity(
    await provider.send('eth_getTransactionCount', [
      target.from,
      quantity(parentNumber),
    ])
  );
  const targetNonce = readEvmRpcQuantity(target.nonce);
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (firstNonce > targetNonce || targetNonce - firstNonce > BigInt(16))
    throw requireExecutionEvidence();
  const transactions: RpcTransaction[] = [];
  for (let nonce = firstNonce; nonce < targetNonce; nonce++) {
    const candidates =
      snapshot?.retained.filter(
        (entry) =>
          entry.chainId === String(chainId) &&
          entry.from.toLowerCase() === target.from.toLowerCase() &&
          BigInt(entry.nonce) === nonce &&
          ['signed', 'attempted', 'submitted'].includes(entry.phase)
      ) ?? [];
    if (
      !candidates.length ||
      candidates.length > 16 ||
      !snapshot?.readSignedTransaction
    )
      throw requireExecutionEvidence();
    // Replaced variants share a nonce. Only the exact variant currently accepted
    // by this endpoint can supply the preceding execution state.
    const observed = await Promise.all(
      candidates.map(async (entry) => ({
        entry,
        transaction: await provider.send('eth_getTransactionByHash', [
          entry.hash,
        ]),
      }))
    );
    assertSynchronousEvmFeeGuard(assertCurrent);
    const accepted = observed.filter(
      ({ entry, transaction }) =>
        transaction?.hash?.toLowerCase() === entry.hash.toLowerCase() &&
        transaction.blockHash === null &&
        transaction.blockNumber === null
    );
    if (accepted.length !== 1) throw requireExecutionEvidence();
    const selected = accepted[0]!;
    const unsigned = await snapshot.readUnsignedNativeTransaction?.(
      selected.entry.hash
    );
    assertSynchronousEvmFeeGuard(assertCurrent);
    const raw = unsigned
      ? (() => {
          const original = Transaction.from(unsigned);
          original.signature = {
            r: selected.transaction.r,
            s: selected.transaction.s,
            v: readEvmRpcQuantity(
              selected.transaction.v ?? selected.transaction.yParity
            ),
          };
          return original.serialized;
        })()
      : await snapshot.readSignedTransaction(selected.entry.hash);
    const predecessor = recoverExecutionSimulationEnvelope(
      raw,
      selected.entry.hash
    );
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (!echoMatches(predecessor, selected.transaction))
      throw requireExecutionEvidence();
    transactions.push(predecessor);
  }
  const paymaster =
    operation.paymasterAndData === '0x'
      ? '0x0000000000000000000000000000000000000000'
      : getAddress(operation.paymasterAndData.slice(0, 42));
  await assertSmartAccountExecutionSimulation({
    assertCurrent,
    identity: captureSmartAccountCallsIdentity(operation, chainId),
    operationEvent: { nonce: BigInt(operation.nonce), paymaster },
    parent: { hash: readEvmRpcHash(parent.hash), number: parentNumber },
    transactions: [...transactions, target],
    simulate: (params) => provider.send('eth_simulateV1', [...params]),
  });
  await verifyEvmCanonicalBlock(
    provider,
    {
      hash: readEvmRpcHash(parent.hash),
      number: parentNumber,
    },
    assertCurrent,
    requireExecutionEvidence
  );
}

/** Replacements and replay recover the already authorized operation from signed bytes. */
export async function assertRetainedSmartAccountExecution(
  provider: Parameters<typeof assertSignedSmartAccountExecution>[0],
  rawTransaction: string,
  hash: string,
  chainId: number,
  snapshot: EvmAutoNonceSnapshot | undefined,
  assertCurrent: () => void
) {
  assertSynchronousEvmFeeGuard(assertCurrent);
  const transaction = Transaction.from(rawTransaction);
  if (
    transaction.to?.toLowerCase() !==
      getPaliEntryPointAddress(chainId).toLowerCase() ||
    transaction.data.slice(0, 10) !==
      paliEntryPointInterface.getFunction('handleOps')!.selector
  )
    return;
  const decoded = paliEntryPointInterface.decodeFunctionData(
    'handleOps',
    transaction.data
  );
  if (
    decoded[0].length !== 1 ||
    paliEntryPointInterface.encodeFunctionData('handleOps', decoded) !==
      transaction.data
  )
    throw requireExecutionEvidence();
  const item = decoded[0][0];
  const operation: SmartAccountPackedUserOperation = {
    sender: item.sender,
    nonce: item.nonce.toString(),
    initCode: item.initCode,
    callData: item.callData,
    accountGasLimits: item.accountGasLimits,
    preVerificationGas: item.preVerificationGas.toString(),
    gasFees: item.gasFees,
    paymasterAndData: item.paymasterAndData,
    signature: item.signature,
  };
  await assertSignedSmartAccountExecution(
    provider,
    rawTransaction,
    hash,
    operation,
    chainId,
    snapshot,
    assertCurrent
  );
}
