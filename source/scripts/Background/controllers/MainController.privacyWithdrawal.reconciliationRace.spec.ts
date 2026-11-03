jest.mock('@trezor/connect-webextension', () => ({}));
jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest
    .fn()
    .mockResolvedValue([]),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/utils/derivation-paths'),
  ...jest.requireActual('@sidhujag/sysweb3-keyring/cjs/signers'),
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/slhDsa', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));

import { webcrypto } from 'crypto';

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import { identifyClassicNote } from 'utils/privacy/note';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import type { IPrivacyWithdrawalsHost } from 'utils/privacy/withdrawTypes';

import MainController from './MainController';
import { createPrivacyWithdrawalsController } from './privacyWithdrawals';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const NOTE_ID = '00000000-0000-4000-8000-000000001000';
const INTENT_ID = '00000000-0000-4000-8000-000000002000';
const NOTE = `tornado-eth-1-1-0x${'00'.repeat(62)}`;
const IDENTITY = identifyClassicNote(NOTE);
const ROOT = `0x${'12'.repeat(32)}`;
const HASH = `0x${'ab'.repeat(32)}`;
const PROOF = `0x${'01'.repeat(256)}`;
const ADDRESS = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const controllers: Array<
  ReturnType<typeof createPrivacyWithdrawalsController>
> = [];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function setup() {
  let clock = 1000;
  const state: any = structuredClone(store.getState());
  state.vault.activeNetwork = {
    kind: 'ethereum',
    chainId: 1,
    url: 'https://operator.example',
  };
  state.vault.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
  state.vault.accounts = {
    [KeyringAccountType.HDAccount]: {
      0: { id: 0, address: ADDRESS },
      1: { id: 1, address: `0x${'22'.repeat(20)}` },
    },
  };
  state.vault.isBitcoinBased = false;
  state.vaultGlobal.activeSlip44 = 60;
  jest.spyOn(store, 'getState').mockImplementation(() => state);
  const events: string[] = [];
  const keyring = { isUnlocked: jest.fn(() => true) };
  const wallet: any = Object.create(MainController.prototype);
  const pendingNonce = jest.fn(async () => 7);
  const provider = {
    send: jest.fn(async (method: string, _params: unknown[]) => {
      if (method === 'eth_getTransactionCount') {
        expect(_params[1]).toBe('pending');
        return `0x${(await pendingNonce()).toString(16)}`;
      }
      if (method === 'eth_chainId') return '0x1';
      throw new Error('Unexpected synthetic RPC');
    }),
    estimateGas: jest.fn(() => {
      throw new Error('No note-specific estimation allowed');
    }),
    call: jest.fn(() => {
      throw new Error('No note-specific contract read allowed');
    }),
    getFeeData: jest.fn(async () => ({
      maxFeePerGas: BigInt(100),
      maxPriorityFeePerGas: BigInt(1),
    })),
    getTransactionCount: jest.fn(() => {
      throw new Error('Cached pending nonce must not be used');
    }),
    getBalance: jest.fn(async () => BigInt(65000000)),
  };
  const vault = {
    getWithdrawalAttempt: jest.fn(async (_id, session) => {
      session.assertCurrent();
      return {
        noteId: NOTE_ID,
        poolId: 'eth-1',
        mode: 'direct',
        phase: 'unknown',
        attemptHash: HASH,
        inputHash: HASH,
        proofHash: HASH,
      };
    }),
    recordWithdrawalJobStatus: jest.fn(async (_id, _hash, _ack, session) => {
      session.assertCurrent();
    }),
    withWithdrawalNote: jest.fn(async (_id, session, use) => {
      session.assertCurrent();
      return use(NOTE, 'eth-1');
    }),
    reserveWithdrawalAttempt: jest.fn(async (_attempt, session) => {
      session.assertCurrent();
      events.push('reserve');
    }),
    recordWithdrawalSubmission: jest.fn(async (_attempt, _ack, session) => {
      session.assertCurrent();
      events.push('record');
    }),
    clearUnbroadcastWithdrawalAttempt: jest.fn(async (_attempt, session) => {
      session.assertCurrent();
      events.push('clear');
    }),
  };
  const snapshot = Object.freeze({
    version: 1 as const,
    chainId: 1 as const,
    poolAddress: PRIVACY_POOLS[1].address,
    asOfBlockNumber: 20000000,
    asOfBlockHash: `0x${'42'.repeat(32)}`,
    root: ROOT,
    leaves: [IDENTITY.commitment],
    leafCount: 1,
    withdrawnNullifiers: [],
  });
  const snapshotGuard = jest.fn((supplied) => {
    if (supplied !== snapshot) throw new Error('privacy_verification_pending');
  });
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    authenticationMutex: new AsyncMutex(),
    privacyDepositSessions: new WeakMap(),
    assertWalletReadyForSigning: jest.fn(),
    getActiveKeyring: () => keyring,
    getPrivateVaultController: jest.fn(async () => vault),
    privacySnapshotReader: jest.fn(() => ({
      snapshot,
      getPath: jest.fn(async () => ({ pathElements: [], pathIndices: [] })),
      assertSnapshotCurrent: snapshotGuard,
    })),
    sendAndSaveEthTransaction: jest.fn(
      async (_tx, _legacy, _account, _metadata, options) => {
        options.assertCurrentContext();
        events.push('send');
        await options.onBroadcast({ hash: HASH });
        return { hash: HASH };
      }
    ),
  });
  Object.defineProperty(wallet, 'ethereumTransaction', {
    configurable: true,
    value: { web3Provider: provider },
  });
  const relayers = {
    getDirectory: jest.fn(),
    checkRelayer: jest.fn(),
    assertSelectionCurrent: jest.fn(),
  };
  const host: IPrivacyWithdrawalsHost =
    wallet.createPrivacyWithdrawalsHost(relayers);
  // This suite tests the real controller/Main boundary, not cryptography. The
  // separately qualified prover is represented by its bound six-input result.
  host.prove = jest.fn(async (request, options) => {
    options.assertCurrent();
    options.assertSnapshotCurrent(request.snapshot);
    return {
      proof: PROOF,
      publicSignals: [
        ROOT,
        IDENTITY.nullifierHash,
        request.recipient,
        request.relayer,
        request.fee,
        request.refund,
      ].map((value) => BigInt(value).toString()),
    };
  });
  const controller = createPrivacyWithdrawalsController(host, {
    now: () => clock,
    randomId: () => INTENT_ID,
  });
  controllers.push(controller);
  wallet.privacyWithdrawalsController = Promise.resolve(controller);
  return {
    state,
    wallet,
    provider,
    pendingNonce,
    vault,
    keyring,
    host,
    controller,
    events,
    snapshotGuard,
    clock: (value: number) => {
      clock = value;
    },
  };
}
const prepare = (wallet: any) =>
  wallet.preparePrivacyWithdrawal({
    noteId: NOTE_ID,
    recipient: RECIPIENT,
    mode: 'direct',
  });

beforeEach(() => {
  jest
    .mocked(getBlacklistTargetsForEvmCallWithContractType)
    .mockReset()
    .mockResolvedValue([]);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  walletPersistenceGate.blocked = false;
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  walletPersistenceGate.blocked = false;
  jest.restoreAllMocks();
});

// Establish a real encrypted unknown journal whose write completed before its
// old session was invalidated; no sender or relayer is entered.
async function pendingRecovery() {
  const { createPrivateVaultController } = await import('./privateVault');
  const ActualKeyring = jest.requireActual(
    '@sidhujag/sysweb3-keyring'
  ).KeyringManager;
  const keyring: any = Object.create(ActualKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => 'synthetic private vault test root';
  keyring.isUnlocked = () => true;
  const run = setup();
  run.wallet.getActiveKeyring = () => keyring;
  run.wallet.getWalletSetupStatus = () => false;
  const records: Record<string, any> = {};
  const storage = {
    getItem: jest.fn(async (key: string) =>
      records[key] ? structuredClone(records[key]) : null
    ),
    setItem: jest.fn(async (key: string, value: any) => {
      records[key] = structuredClone(value);
    }),
  };
  const vault = createPrivateVaultController(
    {
      captureSession: () => run.wallet.capturePrivateVaultSession(),
      authenticate: jest.fn(),
      readNote: async () => ({ phase: 'verified', blockNumber: 20000000 }),
    },
    {
      storage,
      mutex: new AsyncMutex(),
      now: () => 1000,
      randomId: () => NOTE_ID,
    }
  );
  run.wallet.getPrivateVaultController.mockResolvedValue(vault);
  await vault.importNote(NOTE);
  const review = await prepare(run.wallet);
  const written = deferred(),
    release = deferred();
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementationOnce(async (key, value) => {
    await write(key, value);
    written.resolve();
    await release.promise;
  });
  const submission = run.controller.submitWithdrawal(review.intentId);
  const failure = expect(submission).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
  await written.promise;
  run.wallet.walletSessionGeneration += 1;
  release.resolve();
  await failure;
  expect(run.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  expect(run.wallet.knownUnbroadcast.has(review.intentId)).toBe(true);
  expect(
    await vault.getWithdrawalAttempt(
      NOTE_ID,
      run.wallet.capturePrivateVaultSession()
    )
  ).toMatchObject({ phase: 'unknown' });
  return { run, vault, storage, keyring, review };
}

it('serializes concurrent reconciliation calls and clears the matching journal once', async () => {
  const { run, vault, storage, review } = await pendingRecovery();
  const entered = deferred(),
    release = deferred(),
    bothEntered = deferred();
  const clear = vault.clearKnownUnbroadcastWithdrawal.bind(vault);
  const clearSpy = jest
    .spyOn(vault, 'clearKnownUnbroadcastWithdrawal')
    .mockImplementation((...args) => {
      if (clearSpy.mock.calls.length === 2) bothEntered.resolve();
      return clear(...args);
    });
  const write = storage.setItem.getMockImplementation()!;
  storage.setItem.mockImplementationOnce(async (key, value) => {
    entered.resolve();
    await release.promise;
    await write(key, value);
  });
  const first = run.wallet.getPrivateVaultNotes();
  await entered.promise;
  const second = run.wallet.getPrivateVaultNotes();
  await bothEntered.promise;
  // The first holds the persistence mutex while its write is pending.
  let secondSettled = false;
  void second.finally(() => {
    secondSettled = true;
  });
  expect(secondSettled).toBe(false);
  const writesAtHold = storage.setItem.mock.calls.length;
  release.resolve();
  const [a, b] = await Promise.all([first, second]);
  expect(a.notes[0].phase).toBe('verified');
  expect(b.notes[0].phase).toBe('verified');
  expect(storage.setItem.mock.calls.length).toBe(writesAtHold);
  expect(clearSpy).toHaveBeenCalledTimes(2);
  expect(
    await vault.getWithdrawalAttempt(
      NOTE_ID,
      run.wallet.capturePrivateVaultSession()
    )
  ).toBeNull();
  expect(run.wallet.knownUnbroadcast.has(review.intentId)).toBe(false);
  expect(run.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});

it.each(['account change', 'account ABA', 'network ABA'] as const)(
  'does not write a recovery clear after %s during encryption',
  async (transition) => {
    const { run, vault, storage, keyring, review } = await pendingRecovery();
    const entered = deferred(),
      release = deferred();
    const encrypt = keyring.encryptPrivateRecord.bind(keyring);
    jest
      .spyOn(keyring, 'encryptPrivateRecord')
      .mockImplementationOnce(async (...args: any[]) => {
        entered.resolve();
        await release.promise;
        return encrypt(...args);
      });
    const writesBefore = storage.setItem.mock.calls.length;
    const clearing = run.wallet.getPrivateVaultNotes();
    const clearingFailure = expect(clearing).rejects.toThrow(
      'privacy_vault_session_changed'
    );
    await entered.promise;
    run.wallet.walletSessionGeneration += 1;
    if (transition === 'network ABA') {
      run.state.vault.activeNetwork.url = 'https://other.example';
      run.wallet.walletSessionGeneration += 1;
      run.state.vault.activeNetwork.url = 'https://operator.example';
    } else {
      run.state.vault.activeAccount = {
        id: 1,
        type: KeyringAccountType.HDAccount,
      };
      if (transition === 'account ABA') {
        run.wallet.walletSessionGeneration += 1;
        run.state.vault.activeAccount = {
          id: 0,
          type: KeyringAccountType.HDAccount,
        };
      }
    }
    release.resolve();
    await clearingFailure;
    expect(storage.setItem.mock.calls.length).toBe(writesBefore);
    expect(run.wallet.knownUnbroadcast.has(review.intentId)).toBe(true);
    expect(
      await vault.getWithdrawalAttempt(
        NOTE_ID,
        run.wallet.capturePrivateVaultSession()
      )
    ).toMatchObject({ phase: 'unknown' });
    // A new session on another account may read the still-reserved note, but
    // must not clear a capability bound to the original account.
    run.wallet.walletSessionGeneration += 1;
    run.state.vault.activeAccount = {
      id: 1,
      type: KeyringAccountType.HDAccount,
    };
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
    expect(storage.setItem.mock.calls.length).toBe(writesBefore);
    expect(run.wallet.knownUnbroadcast.has(review.intentId)).toBe(true);
    run.wallet.walletSessionGeneration += 1;
    run.state.vault.activeAccount = {
      id: 0,
      type: KeyringAccountType.HDAccount,
    };
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'verified'
    );
    expect(
      await vault.getWithdrawalAttempt(
        NOTE_ID,
        run.wallet.capturePrivateVaultSession()
      )
    ).toBeNull();
    expect(run.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  }
);
