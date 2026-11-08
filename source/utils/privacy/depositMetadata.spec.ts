import { Interface, Transaction, Wallet, parseEther } from 'ethers';

import { KeyringAccountType } from '../../types/network';

import {
  capturePrivateDepositAttempt,
  privateDepositUnsignedBytes,
  readPrivateDepositAttempt,
} from './depositMetadata';
import { getPrivacyPool } from './registry';
import type { IPrivacyDepositAttempt } from './transactionTypes';
import type { EvmRetainedSignedRecord } from '../../wallet/evmSignedRecords';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const pool = getPrivacyPool('eth-1');
const commitment = `0x${'33'.repeat(32)}`;
function attempt(): IPrivacyDepositAttempt {
  return {
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
      chainId: 1,
      slip44: 60,
      rpcUrl: 'https://private.invalid',
      sessionGeneration: 7,
    },
    transaction: {
      chainId: 1,
      from: wallet.address,
      to: pool.address,
      value: parseEther(pool.amount).toString(),
      data: new Interface([
        'function deposit(bytes32) payable',
      ]).encodeFunctionData('deposit', [commitment]),
      gasLimit: '100000',
      nonce: '4',
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
  };
}

async function record(input = attempt()): Promise<EvmRetainedSignedRecord> {
  const rawTransaction = await wallet.signTransaction(
    Transaction.from(privateDepositUnsignedBytes(input))
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
    metadata: { privateDeposit: input },
  };
}

it('captures the exact original public attempt and preserves its hash inputs', async () => {
  const input = attempt();
  const captured = capturePrivateDepositAttempt(input);
  input.context.sessionGeneration = 99;
  input.transaction = { ...input.transaction, nonce: '5' };
  expect(captured.context.sessionGeneration).toBe(7);
  expect(captured.createdAt).toBe(1);
  expect(captured.expiresAt).toBe(60001);
  expect(Object.isFrozen(captured.context.account)).toBe(true);
  expect(readPrivateDepositAttempt(await record(captured))).toEqual(captured);
});

it.each(['from', 'id', 'type', 'nonce', 'commitment'] as const)(
  'rejects changed private provenance %s against the actual signed record',
  async (field) => {
    const entry = await record();
    const changed = attempt();
    if (field === 'from') {
      changed.context.account.address = `0x${'22'.repeat(20)}`;
      changed.transaction = {
        ...changed.transaction,
        from: changed.context.account.address,
      };
    }
    if (field === 'id') changed.context.account.id = 4;
    if (field === 'type')
      changed.context.account.type = KeyringAccountType.Imported;
    if (field === 'nonce')
      changed.transaction = { ...changed.transaction, nonce: '5' };
    if (field === 'commitment')
      changed.transaction = {
        ...changed.transaction,
        data: changed.transaction.data.replace(
          '33'.repeat(32),
          '44'.repeat(32)
        ),
      };
    expect(() =>
      readPrivateDepositAttempt({
        ...entry,
        metadata: { privateDeposit: changed },
      })
    ).toThrow();
  }
);

it('keeps ordinary external deposits ordinary and rejects malformed private markers', async () => {
  const entry = await record();
  expect(
    readPrivateDepositAttempt({ ...entry, metadata: undefined })
  ).toBeNull();
  expect(() =>
    readPrivateDepositAttempt({ ...entry, metadata: { privateDeposit: null } })
  ).toThrow();
  let reads = 0;
  const malicious = Object.defineProperty({}, 'context', {
    enumerable: true,
    get() {
      reads++;
      return {};
    },
  });
  expect(() => capturePrivateDepositAttempt(malicious)).toThrow();
  expect(reads).toBe(0);
});
