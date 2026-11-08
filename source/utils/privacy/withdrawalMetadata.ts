import {
  readEvmOwnData,
  serializePreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { AbiCoder, Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { parseEther, toUtf8Bytes } from 'ethers/utils';

import type { IClassicNoteIdentity } from './note.ts';
import { getPrivacyPool } from './registry.ts';
import type {
  IPrivacyWithdrawalAttempt,
  IPrivacyWithdrawalJournal,
} from './withdrawalTransactionTypes.ts';
import type { EvmRetainedSignedRecord } from '../../wallet/evmSignedRecords.ts';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WITHDRAWAL_ABI = new Interface([
  'function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)',
]);
const HASH = /^0x[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const invalid = (): never => {
  throw new Error('privacy_withdrawal_attempt_invalid');
};

function uint(value: unknown, positive = false): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^(?:0|[1-9][0-9]*|0x(?:0|[1-9a-f][0-9a-f]*))$/.test(value)
  )
    return invalid();
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX || (positive && parsed === BigInt(0)))
    return invalid();
  return parsed;
}

export function createPrivateWithdrawalJournal(
  attempt: IPrivacyWithdrawalAttempt,
  noteId: string,
  identity: Pick<IClassicNoteIdentity, 'poolId' | 'nullifierHash'>
): IPrivacyWithdrawalJournal {
  try {
    const context = attempt?.context;
    const pool = getPrivacyPool(identity.poolId);
    const baseKeys = [
      'context',
      'createdAt',
      'expiresAt',
      'fee',
      'intentId',
      'noteId',
      'nullifierHash',
      'poolId',
      'proof',
      'recipient',
      'refund',
      'relayer',
      'root',
      'mode',
    ];
    const keys =
      attempt?.mode === 'direct'
        ? [...baseKeys, 'transaction']
        : [...baseKeys, 'endpoint', 'ensHash', 'rewardAccount'];
    if (
      !attempt ||
      Object.keys(attempt).some((key) => !keys.includes(key)) ||
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
      !context.account.type ||
      typeof context.account.address !== 'string' ||
      !ADDRESS.test(context.account.address) ||
      typeof attempt.proof !== 'string' ||
      !/^0x[0-9a-f]{512}$/.test(attempt.proof) ||
      typeof attempt.root !== 'string' ||
      !HASH.test(attempt.root) ||
      BigInt(attempt.root) >=
        BigInt(
          '21888242871839275222246405745257275088548364400416034343698204186575808495617'
        ) ||
      attempt.nullifierHash !== identity.nullifierHash ||
      typeof attempt.recipient !== 'string' ||
      !ADDRESS.test(attempt.recipient) ||
      BigInt(attempt.recipient) === BigInt(0) ||
      typeof attempt.relayer !== 'string' ||
      !ADDRESS.test(attempt.relayer) ||
      typeof attempt.fee !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,76})$/.test(attempt.fee) ||
      uint(attempt.fee) >= parseEther(pool.amount) ||
      attempt.refund !== '0'
    )
      throw new Error();
    let modeFields: object;
    let direct: { from: string; nonce: string } | undefined;
    if (attempt.mode === 'direct') {
      const tx = attempt.transaction;
      if (
        BigInt(attempt.relayer) !== BigInt(0) ||
        attempt.fee !== '0' ||
        !tx ||
        tx.chainId !== 1 ||
        typeof tx.from !== 'string' ||
        tx.from.toLowerCase() !== context.account.address.toLowerCase() ||
        typeof tx.to !== 'string' ||
        tx.to.toLowerCase() !== pool.address ||
        uint(tx.value) !== BigInt(0) ||
        tx.data !==
          WITHDRAWAL_ABI.encodeFunctionData('withdraw', [
            attempt.proof,
            attempt.root,
            attempt.nullifierHash,
            attempt.recipient,
            attempt.relayer,
            attempt.fee,
            attempt.refund,
          ]) ||
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
        throw new Error();
      const nonce = uint(tx.nonce);
      if (nonce >= BigInt(1) << BigInt(64)) throw new Error();
      const fees: Record<string, string> = {
        gasLimit: String(uint(tx.gasLimit, true)),
        nonce: String(nonce),
      };
      if (tx.gasPrice !== undefined) {
        if (
          tx.maxFeePerGas !== undefined ||
          tx.maxPriorityFeePerGas !== undefined
        )
          throw new Error();
        fees.gasPrice = String(uint(tx.gasPrice, true));
      } else {
        const max = uint(tx.maxFeePerGas, true),
          priority = uint(tx.maxPriorityFeePerGas);
        if (priority > max) throw new Error();
        fees.maxFeePerGas = String(max);
        fees.maxPriorityFeePerGas = String(priority);
      }
      direct = { from: tx.from.toLowerCase(), nonce: String(nonce) };
      modeFields = {
        transaction: {
          chainId: 1,
          from: direct.from,
          to: pool.address,
          data: tx.data,
          value: '0',
          ...fees,
        },
      };
    } else if (attempt.mode === 'relayed') {
      if (
        typeof attempt.endpoint !== 'string' ||
        attempt.endpoint.length > 2048 ||
        typeof attempt.ensHash !== 'string' ||
        !HASH.test(attempt.ensHash) ||
        typeof attempt.rewardAccount !== 'string' ||
        !ADDRESS.test(attempt.rewardAccount) ||
        attempt.rewardAccount.toLowerCase() !== attempt.relayer.toLowerCase() ||
        BigInt(attempt.relayer) === BigInt(0)
      )
        throw new Error();
      const endpoint = new URL(attempt.endpoint);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
      modeFields = {
        endpoint: attempt.endpoint,
        ensHash: attempt.ensHash,
        rewardAccount: attempt.rewardAccount.toLowerCase(),
      };
    } else throw new Error();
    const inputHash = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        Array(6).fill('uint256'),
        [
          attempt.root,
          attempt.nullifierHash,
          attempt.recipient,
          attempt.relayer,
          attempt.fee,
          attempt.refund,
        ].map((value) => BigInt(value).toString())
      )
    );
    const proofHash = keccak256(attempt.proof);
    const normalized = {
      intentId: attempt.intentId,
      noteId: noteId,
      poolId: pool.id,
      createdAt: attempt.createdAt,
      expiresAt: attempt.expiresAt,
      mode: attempt.mode,
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
      recipient: attempt.recipient.toLowerCase(),
      relayer: attempt.relayer.toLowerCase(),
      fee: attempt.fee,
      refund: '0',
      root: attempt.root,
      nullifierHash: attempt.nullifierHash,
      inputHash,
      proofHash,
      ...modeFields,
    };
    return {
      intentId: attempt.intentId,
      createdAt: attempt.createdAt,
      mode: attempt.mode,
      phase: 'unknown',
      proofHash,
      inputHash,
      attemptHash: keccak256(toUtf8Bytes(JSON.stringify(normalized))),
      ...direct,
      ...(attempt.mode === 'relayed'
        ? { endpoint: attempt.endpoint, ensHash: attempt.ensHash }
        : {}),
    };
  } catch {
    throw new Error('privacy_withdrawal_attempt_invalid');
  }
}

/** Capture the original direct attempt before any asynchronous custody read. */
export function capturePrivateWithdrawalAttempt(
  value: unknown
): Readonly<Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>> {
  const input = readEvmOwnData(value, [
    'context',
    'createdAt',
    'expiresAt',
    'fee',
    'intentId',
    'noteId',
    'nullifierHash',
    'poolId',
    'proof',
    'recipient',
    'refund',
    'relayer',
    'root',
    'mode',
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
    input.transaction !== null &&
    typeof input.transaction === 'object' &&
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
    input.mode !== 'direct' ||
    typeof input.noteId !== 'string' ||
    !UUID.test(input.noteId) ||
    typeof input.poolId !== 'string' ||
    typeof input.nullifierHash !== 'string'
  )
    invalid();
  const attempt = {
    ...input,
    context: { ...context, account: { ...account } },
    transaction: { ...transaction },
  } as unknown as Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>;
  createPrivateWithdrawalJournal(attempt, input.noteId as string, {
    poolId: getPrivacyPool(input.poolId as string).id,
    nullifierHash: input.nullifierHash as string,
  });
  return Object.freeze({
    ...attempt,
    context: Object.freeze({
      ...attempt.context,
      account: Object.freeze(attempt.context.account),
    }),
    transaction: Object.freeze(attempt.transaction),
  });
}

export function privateWithdrawalUnsignedBytes(
  attempt: Readonly<Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>>
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

/** Authenticate the complete proof, public inputs, payer and unsigned envelope. */
export function readPrivateWithdrawalAttempt(
  entry: EvmRetainedSignedRecord
): Readonly<Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>> | null {
  if (!entry.metadata || !Object.hasOwn(entry.metadata, 'privateWithdrawal'))
    return null;
  if (Object.hasOwn(entry.metadata, 'privateDeposit')) invalid();
  const attempt = capturePrivateWithdrawalAttempt(
    entry.metadata.privateWithdrawal
  );
  const transaction = Transaction.from(entry.rawTransaction);
  if (
    entry.operation !== 'send' ||
    transaction.unsignedSerialized !==
      privateWithdrawalUnsignedBytes(attempt) ||
    transaction.hash !== entry.hash ||
    transaction.from?.toLowerCase() !== entry.from.toLowerCase() ||
    attempt.transaction.from.toLowerCase() !== entry.from.toLowerCase() ||
    attempt.context.account.id !== entry.signer.id ||
    attempt.context.account.type !== entry.signer.type
  )
    invalid();
  return attempt;
}
