import {
  readEvmOwnData,
  serializePreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { parseEther } from 'ethers/utils';

import type { IClassicNoteIdentity } from './note.ts';
import { getPrivacyPool } from './registry.ts';
import type {
  IPrivacyDepositAttempt,
  IPrivacyDepositFees,
} from './transactionTypes.ts';
import type { EvmRetainedSignedRecord } from '../../wallet/evmSignedRecords.ts';

const ABI = new Interface(['function deposit(bytes32 commitment) payable']);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const invalid = (): never => {
  throw new Error('privacy_deposit_attempt_invalid');
};

export function privateDepositQuantity(
  value: unknown,
  positive = false
): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(value)
  )
    throw new Error('privacy_deposit_attempt_invalid');
  const parsed = BigInt(value);
  if (
    parsed > (BigInt(1) << BigInt(256)) - BigInt(1) ||
    (positive && parsed === BigInt(0))
  )
    throw new Error('privacy_deposit_attempt_invalid');
  return parsed;
}

/** Canonical journal payload shared with the private vault's attempt hash. */
export function normalizePrivateDepositAttempt(
  attempt: IPrivacyDepositAttempt,
  noteId: string,
  identity: Pick<IClassicNoteIdentity, 'commitment' | 'poolId'>
): IPrivacyDepositAttempt {
  const context = attempt?.context;
  const tx = attempt?.transaction;
  const pool = getPrivacyPool(identity.poolId);
  if (
    !attempt ||
    typeof attempt.intentId !== 'string' ||
    !UUID.test(attempt.intentId) ||
    attempt.noteId !== noteId ||
    attempt.poolId !== identity.poolId ||
    !Number.isSafeInteger(attempt.createdAt) ||
    attempt.createdAt < 0 ||
    !Number.isSafeInteger(attempt.expiresAt) ||
    attempt.expiresAt <= attempt.createdAt ||
    !context ||
    context.chainId !== 1 ||
    !Number.isSafeInteger(context.sessionGeneration) ||
    context.sessionGeneration! < 0 ||
    !Number.isSafeInteger(context.slip44) ||
    context.slip44 < 0 ||
    typeof context.rpcUrl !== 'string' ||
    !context.rpcUrl ||
    context.rpcUrl.length > 2048 ||
    !context.account ||
    !Number.isSafeInteger(context.account.id) ||
    context.account.id < 0 ||
    typeof context.account.type !== 'string' ||
    typeof context.account.address !== 'string' ||
    !ADDRESS.test(context.account.address) ||
    !tx ||
    tx.chainId !== 1 ||
    typeof tx.from !== 'string' ||
    tx.from.toLowerCase() !== context.account.address.toLowerCase() ||
    typeof tx.to !== 'string' ||
    tx.to.toLowerCase() !== pool.address ||
    tx.data !== ABI.encodeFunctionData('deposit', [identity.commitment]) ||
    privateDepositQuantity(tx.value) !== parseEther(pool.amount) ||
    Object.keys(tx).some(
      (key) =>
        ![
          'chainId',
          'from',
          'to',
          'value',
          'data',
          'gasLimit',
          'nonce',
          'gasPrice',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ].includes(key)
    )
  )
    throw new Error('privacy_deposit_attempt_invalid');
  const nonce = privateDepositQuantity(tx.nonce);
  if (nonce >= BigInt(1) << BigInt(64))
    throw new Error('privacy_deposit_attempt_invalid');
  const fees: IPrivacyDepositFees = {
    gasLimit: String(privateDepositQuantity(tx.gasLimit, true)),
    nonce: String(nonce),
  };
  if (tx.gasPrice !== undefined) {
    if (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined)
      throw new Error('privacy_deposit_attempt_invalid');
    fees.gasPrice = String(privateDepositQuantity(tx.gasPrice, true));
  } else {
    const max = privateDepositQuantity(tx.maxFeePerGas, true),
      priority = privateDepositQuantity(tx.maxPriorityFeePerGas);
    if (priority > max) throw new Error('privacy_deposit_attempt_invalid');
    fees.maxFeePerGas = String(max);
    fees.maxPriorityFeePerGas = String(priority);
  }
  const normalized: IPrivacyDepositAttempt = {
    intentId: attempt.intentId,
    noteId: noteId,
    poolId: identity.poolId,
    createdAt: attempt.createdAt,
    expiresAt: attempt.expiresAt,
    context: {
      chainId: 1,
      rpcUrl: context.rpcUrl,
      slip44: context.slip44,
      sessionGeneration: context.sessionGeneration,
      account: {
        id: context.account.id,
        type: context.account.type,
        address: context.account.address.toLowerCase(),
      },
    },
    transaction: {
      chainId: 1,
      from: tx.from.toLowerCase(),
      to: pool.address,
      data: tx.data,
      value: String(privateDepositQuantity(tx.value)),
      ...fees,
    },
  };
  return normalized;
}

/** Capture public provenance without invoking accessors or retaining extra fields. */
export function capturePrivateDepositAttempt(
  value: unknown
): Readonly<IPrivacyDepositAttempt> {
  const input = readEvmOwnData(value, [
    'intentId',
    'noteId',
    'poolId',
    'createdAt',
    'expiresAt',
    'context',
    'transaction',
  ]);
  const context = readEvmOwnData(input.context, [
    'account',
    'chainId',
    'rpcUrl',
    'slip44',
    'sessionGeneration',
  ]);
  const account = readEvmOwnData(context.account, ['id', 'type', 'address']);
  const legacy =
    Object.getOwnPropertyDescriptor(input.transaction, 'gasPrice') !==
    undefined;
  const transaction = readEvmOwnData(input.transaction, [
    'chainId',
    'from',
    'to',
    'value',
    'data',
    'gasLimit',
    'nonce',
    ...(legacy ? ['gasPrice'] : ['maxFeePerGas', 'maxPriorityFeePerGas']),
  ]);
  if (
    typeof input.noteId !== 'string' ||
    !UUID.test(input.noteId) ||
    typeof input.poolId !== 'string' ||
    typeof transaction.data !== 'string'
  )
    invalid();
  const pool = getPrivacyPool(input.poolId as string);
  const [commitment] = ABI.decodeFunctionData(
    'deposit',
    transaction.data as string
  );
  const normalized = normalizePrivateDepositAttempt(
    {
      ...input,
      context: { ...context, account },
      transaction,
    } as unknown as IPrivacyDepositAttempt,
    input.noteId as string,
    { poolId: pool.id, commitment }
  );
  return Object.freeze({
    ...normalized,
    context: Object.freeze({
      ...normalized.context,
      account: Object.freeze(normalized.context.account),
    }),
    transaction: Object.freeze(normalized.transaction),
  });
}

export function privateDepositUnsignedBytes(
  attempt: Readonly<IPrivacyDepositAttempt>
): string {
  const transaction = attempt.transaction;
  return serializePreparedEvmTransaction({
    chainId: '1',
    from: transaction.from,
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value).toString(),
    gasLimit: BigInt(transaction.gasLimit).toString(),
    nonce: BigInt(transaction.nonce).toString(),
    ...(transaction.gasPrice !== undefined
      ? { type: 0, gasPrice: BigInt(transaction.gasPrice).toString() }
      : {
          type: 2,
          accessList: [],
          maxFeePerGas: BigInt(transaction.maxFeePerGas!).toString(),
          maxPriorityFeePerGas: BigInt(
            transaction.maxPriorityFeePerGas!
          ).toString(),
        }),
  });
}

/** The encrypted journal authenticates the marker; signed bytes bind its complete intent. */
export function readPrivateDepositAttempt(
  entry: EvmRetainedSignedRecord
): Readonly<IPrivacyDepositAttempt> | null {
  if (!entry.metadata || !Object.hasOwn(entry.metadata, 'privateDeposit'))
    return null;
  const attempt = capturePrivateDepositAttempt(entry.metadata.privateDeposit);
  const transaction = Transaction.from(entry.rawTransaction);
  if (
    entry.operation !== 'send' ||
    transaction.unsignedSerialized !== privateDepositUnsignedBytes(attempt) ||
    transaction.hash !== entry.hash ||
    transaction.from?.toLowerCase() !== entry.from.toLowerCase() ||
    attempt.transaction.from.toLowerCase() !== entry.from.toLowerCase() ||
    attempt.context.account.id !== entry.signer.id ||
    attempt.context.account.type !== entry.signer.type
  )
    invalid();
  return attempt;
}
