jest.mock('@trezor/connect-webextension', () => ({}));
jest.unmock('syscoinjs-lib');
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

import { createPrivacyWithdrawalsController } from '../../../wallet/privacyWithdrawals';
import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import { identifyClassicNote } from 'utils/privacy/note';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import type { IPrivacyWithdrawalsHost } from 'utils/privacy/withdrawTypes';

import MainController from './MainController';

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
  let unlockEpoch = 0;
  const keyring = {
    isUnlocked: jest.fn(() => true),
    lockWallet: jest.fn(async () => {
      unlockEpoch++;
    }),
    captureUnlockedSessionGuard: jest.fn(() => {
      const epoch = unlockEpoch;
      return () => {
        if (epoch !== unlockEpoch || !keyring.isUnlocked())
          throw new Error('retired unlock');
      };
    }),
  };
  const wallet: any = Object.create(MainController.prototype);
  const pendingNonce = jest.fn(async () => 7);
  const provider = {
    send: jest.fn(async (method: string, _params: unknown[]) => {
      if (method === 'eth_getTransactionCount') {
        expect(_params[1]).toBe('pending');
        return `0x${(await pendingNonce()).toString(16)}`;
      }
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getBlockByNumber')
        return {
          number: '0x10',
          hash: '0x' + 'aa'.repeat(32),
          gasLimit: '0x1c9c380',
          baseFeePerGas: '0x2',
        };
      if (method === 'eth_getBalance')
        return '0x' + (await provider.getBalance()).toString(16);
      if (method === 'eth_maxPriorityFeePerGas') return '0x1';
      throw new Error('Unexpected synthetic RPC');
    }),
    getGasPrice: jest.fn(async () => BigInt(5)),
    verifyConfiguredChainId: jest.fn(async () => undefined),
    signal: new AbortController().signal,
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
  (provider as any)._send = jest.fn(
    async ({
      id,
      method,
      params,
    }: {
      id: number;
      method: string;
      params: unknown[];
    }) => [{ jsonrpc: '2.0', id, result: await provider.send(method, params) }]
  );
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
    reserveWithdrawalAttempt: jest.fn(async (_attempt, session, onIdentity) => {
      session.assertCurrent();
      onIdentity?.({
        assertRestoreCurrent: () => undefined,
        attemptHash: HASH,
        profileId: '0x' + '11'.repeat(32),
      });
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
    captureFreshEvmRead: jest.fn(() => ({
      network: state.vault.activeNetwork,
      assertCurrent: () => undefined,
      overrides: {},
      run: (operation: (reader: unknown) => unknown) =>
        operation(wallet.ethereumTransaction.web3Provider),
    })),
    inspectOrdinaryEvmNonce: jest.fn(async (_read, address, options) => {
      options?.assertCurrent?.();
      const observed = Number(
        BigInt(
          await wallet.ethereumTransaction.web3Provider.send(
            'eth_getTransactionCount',
            [address, 'pending']
          )
        )
      );
      options?.assertCurrent?.();
      return {
        nonce: observed,
        state: 'pending',
        balanceState: 'pending',
        canonicalBlock: { hash: '0x' + 'aa'.repeat(32), number: '16' },
        nativeReservations: { canonical: BigInt(0), pending: BigInt(0) },
      };
    }),
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

it.each([
  'reservation interrupted',
  'healthy accepted',
  'watch-only accepted',
  'post entered unknown',
] as const)('relayed reservation and recovery: %s', async (scenario) => {
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
  keyring.captureUnlockedSessionGuard = () => () => undefined;
  const run = setup();
  if (scenario === 'watch-only accepted') {
    run.state.vault.activeAccount = {
      id: 0,
      type: KeyringAccountType.Imported,
    };
    run.state.vault.accounts[KeyringAccountType.Imported] = {
      0: { id: 0, address: ADDRESS, xprv: '' },
    };
  }
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
  // The note identity stays fixed; encrypted root/shards need distinct UUIDs.
  let recordSequence = 100;
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
      randomId: () =>
        recordSequence++ === 100
          ? NOTE_ID
          : `00000000-0000-4000-8000-${recordSequence
              .toString(16)
              .padStart(12, '0')}`,
    }
  );
  run.wallet.getPrivateVaultController.mockResolvedValue(vault);
  await vault.importNote(NOTE);
  const relayerId = `0x${'44'.repeat(32)}`;
  const rewardAccount = `0x${'55'.repeat(20)}`;
  const directory: any = {
    relayers: [
      {
        ensHash: relayerId,
        ensName: 'synthetic-relay.eth',
        health: 'reported-healthy',
        supportedPools: ['eth-1'],
      },
    ],
  };
  const selection: any = {
    directory,
    endpoint: 'https://relay.example',
    ensHash: relayerId,
    poolId: 'eth-1',
    rewardAccount,
    advertisedServiceFeePercent: '0.3',
  };
  jest.mocked(run.host.relayers.getDirectory).mockResolvedValue(directory);
  jest.mocked(run.host.relayers.checkRelayer).mockResolvedValue(selection);
  const jobId = '00000000-0000-4000-8000-000000003000';
  const fetcher = jest.fn(async () => {
    if (scenario === 'post entered unknown')
      throw new Error('synthetic relay transport failure');
    return new Response(JSON.stringify({ id: jobId }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const controller = createPrivacyWithdrawalsController(run.host, {
    now: () => 1000,
    randomId: () => INTENT_ID,
    fetcher,
  });
  controllers.push(controller);
  run.wallet.privacyWithdrawalsController = Promise.resolve(controller);
  await controller.getRelayers();
  const review = await controller.prepareWithdrawal({
    noteId: NOTE_ID,
    recipient: RECIPIENT,
    mode: 'relayed',
    relayerId,
  });
  const committed = deferred(),
    release = deferred();
  if (scenario === 'reservation interrupted') {
    const write = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementationOnce(async (key, value) => {
      await write(key, value);
      committed.resolve();
      await release.promise;
    });
  }
  const submission = controller.submitWithdrawal(review.intentId);
  if (scenario === 'reservation interrupted') {
    const rejected = expect(submission).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    await committed.promise;
    run.wallet.walletSessionGeneration += 1;
    release.resolve();
    await rejected;
    expect(fetcher).not.toHaveBeenCalled();
    expect((await vault.getNotes()).notes[0]).toMatchObject({
      phase: 'waiting',
      withdrawal: { mode: 'relayed', phase: 'unknown' },
    });
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'verified'
    );
    expect(
      await vault.getWithdrawalAttempt(
        NOTE_ID,
        run.wallet.capturePrivateVaultSession()
      )
    ).toBeNull();
  } else {
    const result = await submission;
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (scenario === 'healthy accepted' || scenario === 'watch-only accepted') {
      expect(result).toMatchObject({ phase: 'submitted', jobId });
      expect((await run.wallet.getPrivateVaultNotes()).notes[0]).toMatchObject({
        phase: 'waiting',
        withdrawal: { mode: 'relayed', phase: 'submitted', jobId },
      });
    } else {
      expect(result).toMatchObject({ phase: 'unknown' });
      expect((await run.wallet.getPrivateVaultNotes()).notes[0]).toMatchObject({
        phase: 'waiting',
        withdrawal: { mode: 'relayed', phase: 'unknown' },
      });
    }
  }
});
