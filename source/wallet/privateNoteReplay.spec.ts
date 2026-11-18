import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import { Interface, Transaction, Wallet, parseEther } from 'ethers';

import { KeyringAccountType } from '../types/network';
import { AsyncMutex } from '../utils/asyncMutex';
import { privateDepositUnsignedBytes } from '../utils/privacy/depositMetadata';
import { identifyClassicNote } from '../utils/privacy/note';
import { getPrivacyPool } from '../utils/privacy/registry';
import {
  capturePrivateWithdrawalAttempt,
  privateWithdrawalUnsignedBytes,
} from '../utils/privacy/withdrawalMetadata';

import { EvmSignedRecords } from './evmSignedRecords';
import { createPrivateVaultSession } from './privateVault';
import { createPrivateVaultController } from './privateVault';
import type { IPrivacyDepositAttempt } from '../utils/privacy/transactionTypes';
import type { IPrivacyWithdrawalAttempt } from '../utils/privacy/withdrawalTransactionTypes';

jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({}));
const NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const signer = new Wallet(`0x${'11'.repeat(32)}`);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

async function fixture(
  tagged = true,
  retained = true,
  kind: 'deposit' | 'withdrawal' = 'deposit'
) {
  const keyring: any = Object.create(KeyringManager.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'synthetic private deposit integration root';
  const values: Record<string, any> = {};
  const mutex = new AsyncMutex();
  let generation = 1,
    sequence = 1;
  const session = () => {
    const captured = generation;
    return createPrivateVaultSession({
      keyring,
      generation,
      assertCurrent() {
        if (captured !== generation) throw Error('retired');
      },
    });
  };
  const dependencies = {
    mutex,
    generate: () => NOTE,
    identify: identifyClassicNote,
    now: () => 1000,
    deadlineNow: () => 1000,
    randomId: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    storage: {
      getItem: async (key: string) => values[key],
      setItem: async (key: string, value: unknown) => {
        values[key] = value;
      },
    },
  };
  let noteStatus: 'not-found' | 'verified' = 'not-found';
  const host = {
    captureSession: session,
    readNote: async () => ({ phase: noteStatus }),
    authenticate: async (
      _password: string,
      scope: ReturnType<typeof session>,
      reveal: () => Promise<any>
    ) => {
      scope.assertCurrent();
      return reveal();
    },
  };
  const vault = () => createPrivateVaultController(host, dependencies);
  const note = await vault().createDepositNote('eth-1');
  const pool = getPrivacyPool('eth-1');
  const attempt: IPrivacyDepositAttempt = {
    intentId: '00000000-0000-4000-8000-000000000099',
    noteId: note.id,
    poolId: pool.id,
    createdAt: 1000,
    expiresAt: 61000,
    context: {
      chainId: 1,
      rpcUrl: 'https://private.invalid',
      slip44: 60,
      sessionGeneration: generation,
      account: {
        id: 0,
        type: KeyringAccountType.HDAccount,
        address: signer.address,
      },
    },
    transaction: {
      chainId: 1,
      from: signer.address,
      to: pool.address,
      value: parseEther(pool.amount).toString(),
      data: new Interface([
        'function deposit(bytes32) payable',
      ]).encodeFunctionData('deposit', [identifyClassicNote(NOTE).commitment]),
      gasLimit: '100000',
      nonce: '0',
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
  };
  let direct: Extract<IPrivacyWithdrawalAttempt, { mode: 'direct' }> = {
    ...attempt,
    mode: 'direct',
    proof: '0x' + 'ab'.repeat(256),
    root: '0x' + '01'.repeat(32),
    rootAnchor: {
      root: '0x' + '01'.repeat(32),
      blockNumber: '8',
      blockHash: '0x' + '55'.repeat(32),
    },
    nullifierHash: identifyClassicNote(NOTE).nullifierHash,
    recipient: signer.address,
    relayer: '0x' + '00'.repeat(20),
    fee: '0',
    refund: '0',
    transaction: {
      ...attempt.transaction,
      gasLimit: '650000',
      value: '0',
      data: '',
    },
  };
  direct = {
    ...direct,
    transaction: {
      ...direct.transaction,
      data: new Interface([
        'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256) payable',
      ]).encodeFunctionData('withdraw', [
        direct.proof,
        direct.root,
        direct.nullifierHash,
        direct.recipient,
        direct.relayer,
        direct.fee,
        direct.refund,
      ]),
    },
  };
  const privateAttempt = kind === 'deposit' ? attempt : direct;
  if (kind === 'deposit')
    await vault().reserveDepositAttempt(attempt, session());
  else {
    noteStatus = 'verified';
    await vault().reserveWithdrawalAttempt(
      direct,
      session(),
      '00000000-0000-4000-8000-000000000099:0'
    );
  }
  const raw = await signer.signTransaction(
    Transaction.from(
      kind === 'deposit'
        ? privateDepositUnsignedBytes(attempt)
        : privateWithdrawalUnsignedBytes(direct)
    )
  );
  const tx = Transaction.from(raw);
  const storage = {
    read: async (profile: string) => values[`signed:${profile}`],
    compareAndSet: async (
      profile: string,
      expected: string | undefined,
      next: string,
      check: () => void
    ) =>
      mutex.runExclusive(async () => {
        check();
        const key = `signed:${profile}`;
        if (values[key] !== expected) return false;
        values[key] = next;
        return true;
      }),
  };
  let journal = new EvmSignedRecords(storage, () => 1000);
  const records = () => journal;
  const context = {
    account: attempt.context.account,
    network: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: attempt.context.rpcUrl,
    },
    operation: 'send' as const,
  };
  if (retained) {
    await records().append(
      session(),
      {
        context,
        rawTransaction: raw,
        hash: tx.hash!,
        from: signer.address,
        chainId: '1',
        nonce: 0,
        type: 2,
      },
      tagged
        ? kind === 'deposit'
          ? { privateDeposit: attempt }
          : { privateWithdrawal: capturePrivateWithdrawalAttempt(direct) }
        : undefined
    );
  }
  return {
    attempt: privateAttempt,
    tx,
    raw,
    vault,
    session,
    records,
    storedJournal: () =>
      JSON.stringify(
        Object.entries(values).filter(([key]) => key.startsWith('signed:'))
      ),
    restart() {
      generation++;
      journal = new EvmSignedRecords(storage, () => 1000);
    },
  };
}

it.each(['deposit', 'withdrawal'] as const)(
  'refuses tagged private %s speed-up without changing its reservation',
  async (kind) => {
    const f = await fixture(true, true, kind);
    const records = f.records();
    await expect(
      records.readReplacement(
        f.session(),
        '1',
        signer.address,
        f.tx.hash!,
        'speed-up'
      )
    ).resolves.toBeNull();
    await expect(
      records.captureVerifiedReplacement(f.session(), {
        chainId: '1',
        from: signer.address,
        nonce: 0,
        originalHash: f.tx.hash!,
        operation: 'speed-up',
      })
    ).rejects.toThrow('EVM_PRIVATE_NOTE_REPLACEMENT_UNAVAILABLE');
  }
);

it('clears the local withdrawal pause with Activity while preserving the note history', async () => {
  const f = await fixture(true, true, 'withdrawal');
  const records = f.records();
  const session = f.session();
  const previous = await f
    .vault()
    .getWithdrawalAttempt(f.attempt.noteId, session);
  await expect(
    records.pendingPrivacyWithdrawalNotes(session, signer.address)
  ).resolves.toEqual(new Set([f.attempt.noteId]));
  await expect(
    records.pendingPrivacyWithdrawalNotes(session, '0x' + 'ab'.repeat(20))
  ).resolves.toEqual(new Set());
  await records.clearScope(session, {
    profileId: await session.keyring.getPrivateRecordProfileId(),
    chainId: '1',
    from: signer.address,
  });
  await expect(
    records.pendingPrivacyWithdrawalNotes(f.session(), signer.address)
  ).resolves.toEqual(new Set());
  await expect(
    f.vault().getWithdrawalAttempt(f.attempt.noteId, f.session())
  ).resolves.toEqual(previous);
});

it('refuses generic private withdrawal cancellation and preserves the encrypted reservation after restart', async () => {
  const f = await fixture(true, true, 'withdrawal');
  const before = f.storedJournal();
  const reservation = await f
    .vault()
    .getWithdrawalAttempt(f.attempt.noteId, f.session());
  await expect(
    f
      .records()
      .readReplacement(f.session(), '1', signer.address, f.tx.hash!, 'cancel')
  ).resolves.toBeNull();
  await expect(
    f.records().captureVerifiedReplacement(f.session(), {
      chainId: '1',
      from: signer.address,
      nonce: 0,
      originalHash: f.tx.hash!,
      operation: 'cancel',
    })
  ).rejects.toThrow('EVM_PRIVATE_NOTE_REPLACEMENT_UNAVAILABLE');
  expect(f.storedJournal()).toBe(before);
  f.restart();
  expect(
    await f.vault().getWithdrawalAttempt(f.attempt.noteId, f.session())
  ).toEqual(reservation);
  expect(
    (await f.records().readExact(f.session(), '1', signer.address, f.tx.hash!))
      ?.rawTransaction
  ).toBe(f.raw);
});
