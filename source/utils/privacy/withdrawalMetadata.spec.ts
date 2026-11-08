import {
  AbiCoder,
  Interface,
  Transaction,
  Wallet,
  keccak256,
  toUtf8Bytes,
} from 'ethers';

import { KeyringAccountType } from '../../types/network';

import { getPrivacyPool } from './registry';
import {
  capturePrivateWithdrawalAttempt,
  createPrivateWithdrawalJournal,
  privateWithdrawalUnsignedBytes,
  readPrivateWithdrawalAttempt,
} from './withdrawalMetadata';
import type { IPrivacyWithdrawalAttempt } from './withdrawalTransactionTypes';
import type { EvmRetainedSignedRecord } from '../../wallet/evmSignedRecords';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const pool = getPrivacyPool('eth-1');
const abi = new Interface([
  'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)',
]);
type DirectAttempt = Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }>;

function attempt(legacy = false): DirectAttempt {
  const input = {
    intentId: '00000000-0000-4000-8000-000000000001',
    noteId: '00000000-0000-4000-8000-000000000002',
    poolId: pool.id,
    createdAt: 1,
    expiresAt: 60001,
    context: {
      account: {
        id: 3,
        type: KeyringAccountType.HDAccount,
        address: wallet.address,
      },
      chainId: 1 as const,
      slip44: 60,
      rpcUrl: 'https://private.invalid',
      sessionGeneration: 7,
    },
    mode: 'direct' as const,
    proof: `0x${'ab'.repeat(256)}`,
    root: `0x${'01'.repeat(32)}`,
    nullifierHash: `0x${'02'.repeat(32)}`,
    recipient: `0x${'22'.repeat(20)}`,
    relayer: `0x${'00'.repeat(20)}`,
    fee: '0',
    refund: '0' as const,
  };
  return {
    ...input,
    transaction: {
      chainId: 1,
      from: wallet.address,
      to: pool.address,
      value: '0',
      data: abi.encodeFunctionData('withdraw', [
        input.proof,
        input.root,
        input.nullifierHash,
        input.recipient,
        input.relayer,
        input.fee,
        input.refund,
      ]),
      gasLimit: '650000',
      nonce: '4',
      ...(legacy
        ? { gasPrice: '3' }
        : { maxFeePerGas: '3', maxPriorityFeePerGas: '1' }),
    },
  };
}

async function record(input = attempt()): Promise<EvmRetainedSignedRecord> {
  const rawTransaction = await wallet.signTransaction(
    Transaction.from(privateWithdrawalUnsignedBytes(input))
  );
  return {
    chainId: '1',
    from: wallet.address.toLowerCase(),
    nonce: 4,
    operation: 'send',
    phase: 'signed',
    createdAt: 1,
    signer: { id: 3, type: KeyringAccountType.HDAccount },
    hash: Transaction.from(rawTransaction).hash!,
    rawTransaction,
    metadata: { privateWithdrawal: input },
  };
}

test.each([false, true])(
  'retains canonical journal bytes and original attempt fields, legacy=%s',
  async (legacy) => {
    const input = attempt(legacy);
    const inputHash = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        Array(6).fill('uint256'),
        [
          input.root,
          input.nullifierHash,
          input.recipient,
          input.relayer,
          input.fee,
          input.refund,
        ].map((value) => BigInt(value).toString())
      )
    );
    const proofHash = keccak256(input.proof);
    const normalized = {
      intentId: input.intentId,
      noteId: input.noteId,
      poolId: pool.id,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      mode: input.mode,
      context: {
        chainId: 1,
        rpcUrl: input.context.rpcUrl,
        slip44: input.context.slip44,
        sessionGeneration: input.context.sessionGeneration,
        account: {
          id: 3,
          type: KeyringAccountType.HDAccount,
          address: wallet.address.toLowerCase(),
        },
      },
      recipient: input.recipient,
      relayer: input.relayer,
      fee: '0',
      refund: '0',
      root: input.root,
      nullifierHash: input.nullifierHash,
      inputHash,
      proofHash,
      transaction: {
        chainId: 1,
        from: wallet.address.toLowerCase(),
        to: pool.address,
        data: input.transaction.data,
        value: '0',
        gasLimit: '650000',
        nonce: '4',
        ...(legacy
          ? { gasPrice: '3' }
          : { maxFeePerGas: '3', maxPriorityFeePerGas: '1' }),
      },
    };
    expect(
      createPrivateWithdrawalJournal(input, input.noteId, {
        poolId: pool.id,
        nullifierHash: input.nullifierHash,
      })
    ).toEqual({
      intentId: input.intentId,
      createdAt: input.createdAt,
      mode: 'direct',
      phase: 'unknown',
      proofHash,
      inputHash,
      attemptHash: keccak256(toUtf8Bytes(JSON.stringify(normalized))),
      from: wallet.address.toLowerCase(),
      nonce: '4',
    });
    const captured = capturePrivateWithdrawalAttempt(input);
    input.context.sessionGeneration = 99;
    expect(captured.context.sessionGeneration).toBe(7);
    expect(captured.expiresAt).toBe(60001);
    expect(Object.isFrozen(captured.context.account)).toBe(true);
    expect(Object.isFrozen(captured.transaction)).toBe(true);
    expect(readPrivateWithdrawalAttempt(await record(captured))).toEqual(
      captured
    );
  }
);

test.each([
  'proof',
  'root',
  'nullifier',
  'recipient',
  'payer',
  'account',
  'type',
  'nonce',
  'gas',
  'chain',
] as const)(
  'rejects changed %s provenance against the signed transaction',
  async (field) => {
    const entry = await record();
    const changed: { -readonly [K in keyof DirectAttempt]: DirectAttempt[K] } =
      structuredClone(attempt());
    if (field === 'proof') changed.proof = `0x${'ac'.repeat(256)}`;
    if (field === 'root') changed.root = `0x${'03'.repeat(32)}`;
    if (field === 'nullifier') changed.nullifierHash = `0x${'04'.repeat(32)}`;
    if (field === 'recipient') changed.recipient = `0x${'33'.repeat(20)}`;
    if (field === 'payer')
      changed.context.account.address = `0x${'44'.repeat(20)}`;
    if (field === 'account') changed.context.account.id = 4;
    if (field === 'type')
      changed.context.account.type = KeyringAccountType.Imported;
    if (field === 'chain') changed.context.chainId = 2;
    changed.transaction = {
      ...changed.transaction,
      from: changed.context.account.address,
      data: abi.encodeFunctionData('withdraw', [
        changed.proof,
        changed.root,
        changed.nullifierHash,
        changed.recipient,
        changed.relayer,
        changed.fee,
        changed.refund,
      ]),
      ...(field === 'nonce' ? { nonce: '5' } : {}),
      ...(field === 'gas' ? { gasLimit: '700000' } : {}),
    };
    expect(() =>
      readPrivateWithdrawalAttempt({
        ...entry,
        metadata: { privateWithdrawal: changed },
      })
    ).toThrow();
  }
);

test('rejects mixed markers, unowned fields and accessors without evaluating them', async () => {
  const entry = await record();
  expect(
    readPrivateWithdrawalAttempt({ ...entry, metadata: undefined })
  ).toBeNull();
  expect(() =>
    readPrivateWithdrawalAttempt({
      ...entry,
      metadata: { ...entry.metadata, privateDeposit: {} },
    })
  ).toThrow();
  const getter = jest.fn(() => attempt().proof);
  const input = Object.defineProperty(attempt(), 'proof', {
    enumerable: true,
    get: getter,
  });
  expect(() => capturePrivateWithdrawalAttempt(input)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() =>
    capturePrivateWithdrawalAttempt({ ...attempt(), extra: true })
  ).toThrow();
});
