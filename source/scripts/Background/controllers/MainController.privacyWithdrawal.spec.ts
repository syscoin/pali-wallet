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
  getWalletNavigationScope: jest.fn(() => ({})),
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/slhDsa', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn().mockResolvedValue(undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn().mockResolvedValue(undefined),
  clearSLHDSAXmssTreeCache: jest.fn().mockResolvedValue(undefined),
}));

import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { webcrypto } from 'crypto';
import { Interface, Transaction } from 'ethers';

import { getController } from '..';
import { createTestEvmSubmissionCapture } from '../../../../tests/helpers/evmSubmission';
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
import {
  captureGenericEvmFeeDispatch,
  markGenericEvmFeeSdkEntered,
} from './nativeEvmFeeReviews';

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
const ABI = new Interface([
  'function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256) payable',
]);
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
  Object.defineProperty(keyring, 'ethereumTransaction', {
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

const selectImportedAccount = (state: any, xprv = '') => {
  state.vault.activeAccount = { id: 0, type: KeyringAccountType.Imported };
  const account = { id: 0, address: ADDRESS, xprv };
  state.vault.accounts[KeyringAccountType.Imported] = { 0: account };
  return account;
};

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

it.each(['healthy', 'snapshot', 'expiry', 'service change'] as const)(
  'checks %s withdrawal admission after the actual sender preflight and before signing',
  async (state) => {
    const run = setup();
    const entered = deferred(),
      release = deferred();
    const signer = jest.fn(async () => {
      run.events.push('sign');
      return { hash: HASH, nonce: 7 };
    });
    Object.defineProperty(run.keyring, 'ethereumTransaction', {
      configurable: true,
      value: {
        web3Provider: run.provider,
        sendFormattedTransaction: signer,
      },
    });
    run.wallet.getWalletSetupStatus = jest.fn(() => undefined);
    run.wallet.sendAndSaveTransaction = jest.fn(async () => undefined);
    // Exercise the actual wrapper's asynchronous preflight and final guard.
    // The SDK boundary is a no-network signer spy; no transaction is broadcast.
    run.wallet.sendAndSaveEthTransaction =
      MainController.prototype.sendAndSaveEthTransaction.bind(run.wallet);
    jest.mocked(getController).mockReturnValue({ wallet: run.wallet } as any);
    const review = await prepare(run.wallet);
    jest
      .mocked(getBlacklistTargetsForEvmCallWithContractType)
      .mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        return [];
      });
    const result = run.wallet.submitPrivacyWithdrawal(review.intentId).then(
      (value: unknown) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    await entered.promise;
    expect(run.vault.reserveWithdrawalAttempt).toHaveBeenCalledTimes(1);
    expect(signer).not.toHaveBeenCalled();
    if (state === 'snapshot')
      run.snapshotGuard.mockImplementation(() => {
        throw new Error('privacy_verification_pending');
      });
    if (state === 'expiry') run.clock(review.expiresAt);
    if (state === 'service change')
      await run.wallet.invalidatePrivacyServiceWithdrawals();
    release.resolve();
    const settled = await result;
    if (state === 'healthy') {
      expect(settled.error).toBeUndefined();
      expect(settled.value).toMatchObject({
        phase: 'submitted',
        transactionHash: HASH,
      });
      expect(signer).toHaveBeenCalledTimes(1);
      expect(run.events).toEqual(['reserve', 'sign', 'record']);
      expect(
        run.vault.clearUnbroadcastWithdrawalAttempt
      ).not.toHaveBeenCalled();
    } else {
      expect(signer).not.toHaveBeenCalled();
      expect(settled.value).toBeUndefined();
      expect(settled.error).toMatchObject({
        message:
          state === 'snapshot'
            ? 'privacy_verification_pending'
            : state === 'service change'
            ? 'privacy_withdrawal_cancelled'
            : 'privacy_withdrawal_intent_expired',
        transactionNotBroadcast: true,
      });
      expect(run.vault.clearUnbroadcastWithdrawalAttempt).toHaveBeenCalledTimes(
        1
      );
      expect(run.vault.recordWithdrawalSubmission).not.toHaveBeenCalled();
      expect(run.events).toEqual(['reserve', 'clear']);
    }
  }
);

it.each(['healthy', 'snapshot', 'expiry', 'expiry after broadcast'] as const)(
  'checks %s withdrawal admission after the actual SDK chain verification and before local signing',
  async (condition) => {
    const run = setup();
    const entered = deferred(),
      release = deferred();
    const localSigner = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    );
    const { EthereumTransactions } = jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum'
    );
    const privateKey =
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const address = localSigner.privateKeyToAccount(privateKey).address;
    run.state.vault.accounts[KeyringAccountType.HDAccount][0].address = address;
    const provider = {
      ...run.provider,
      verifyConfiguredChainId: jest.fn(async () => {
        if (!run.vault.reserveWithdrawalAttempt.mock.calls.length) return;
        entered.resolve();
        await release.promise;
      }),
      sendTransaction: jest.fn(async () => {
        // Once the sender was entered, expiry does not make its known hash
        // disappear or turn the transaction into a retryable pre-send failure.
        if (condition === 'expiry after broadcast') run.clock(review.expiresAt);
        return { hash: HASH, nonce: 7 };
      }),
    };
    const sdk = new EthereumTransactions(
      () => run.state.vault.activeNetwork,
      () => ({ address, decryptedPrivateKey: privateKey }),
      () => ({
        activeAccountId: run.state.vault.activeAccount.id,
        activeAccountType: run.state.vault.activeAccount.type,
        activeNetwork: run.state.vault.activeNetwork,
        accounts: run.state.vault.accounts,
      }),
      {},
      {},
      () => () => undefined,
      createTestEvmSubmissionCapture()
    );
    Object.defineProperty(sdk, 'web3Provider', {
      configurable: true,
      get: () => provider,
    });
    const sign = jest.spyOn(localSigner, 'signTransaction');
    Object.defineProperty(run.keyring, 'ethereumTransaction', {
      configurable: true,
      value: sdk,
    });
    run.wallet.getWalletSetupStatus = jest.fn(() => undefined);
    run.wallet.sendAndSaveTransaction = jest.fn(async () => undefined);
    run.wallet.sendAndSaveEthTransaction =
      MainController.prototype.sendAndSaveEthTransaction.bind(run.wallet);
    jest.mocked(getController).mockReturnValue({ wallet: run.wallet } as any);
    const review = await prepare(run.wallet);
    const result = run.wallet.submitPrivacyWithdrawal(review.intentId).then(
      (value: unknown) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    await entered.promise;
    expect(run.vault.reserveWithdrawalAttempt).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    if (condition === 'snapshot')
      run.snapshotGuard.mockImplementation(() => {
        throw new Error('privacy_verification_pending');
      });
    if (condition === 'expiry') run.clock(review.expiresAt);
    release.resolve();
    const settled = await result;
    if (condition === 'healthy' || condition === 'expiry after broadcast') {
      expect(settled.error).toBeUndefined();
      expect(settled.value).toMatchObject({
        phase: 'submitted',
        transactionHash: HASH,
      });
      expect(sign).toHaveBeenCalledTimes(1);
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      expect(run.vault.recordWithdrawalSubmission).toHaveBeenCalledTimes(1);
      expect(
        run.vault.clearUnbroadcastWithdrawalAttempt
      ).not.toHaveBeenCalled();
    } else {
      expect(sign).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
      expect(settled.value).toBeUndefined();
      expect(settled.error).toMatchObject({
        message:
          condition === 'snapshot'
            ? 'privacy_verification_pending'
            : 'privacy_withdrawal_intent_expired',
        transactionNotBroadcast: true,
      });
      expect(run.vault.clearUnbroadcastWithdrawalAttempt).toHaveBeenCalledTimes(
        1
      );
      expect(run.vault.recordWithdrawalSubmission).not.toHaveBeenCalled();
    }
  }
);
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.close();
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  walletPersistenceGate.blocked = false;
  jest.restoreAllMocks();
});

it('quotes a fresh pending nonce and rechecks it even while the actual SDK read cache retains the previous nonce', async () => {
  jest.useFakeTimers();
  const { CustomJsonRpcProvider } = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/providers'
  );
  const live = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://synthetic.invalid',
    1
  );
  let pending = '0x7';
  const requests: string[] = [];
  live.requestRpc = jest.fn(async (calls: Array<{ method: string }>) =>
    calls.map(({ method }) => {
      requests.push(method);
      if (method !== 'eth_getTransactionCount' && method !== 'eth_chainId')
        return {
          jsonrpc: '2.0',
          result:
            method === 'eth_getBlockByNumber'
              ? {
                  number: '0x10',
                  hash: '0x' + 'aa'.repeat(32),
                  gasLimit: '0x1c9c380',
                  baseFeePerGas: '0x2',
                }
              : method === 'eth_getBalance'
              ? '0x3dfd240'
              : method === 'eth_maxPriorityFeePerGas'
              ? '0x1'
              : undefined,
        };
      return {
        jsonrpc: '2.0',
        result: method === 'eth_chainId' ? '0x1' : pending,
      };
    })
  );
  live.getFeeData = jest.fn(async () => ({
    maxFeePerGas: BigInt(100),
    maxPriorityFeePerGas: BigInt(1),
  }));
  live.getBalance = jest.fn(async () => BigInt(65000000));
  live.getGasPrice = jest.fn(async () => BigInt(5));
  const { wallet, host, vault } = setup();
  wallet.ethereumTransaction.web3Provider = live;
  try {
    expect(await live.getTransactionCount(ADDRESS, 'pending')).toBe(7);
    pending = '0x8';
    expect(await live.getTransactionCount(ADDRESS, 'pending')).toBe(7); // Healthy cache control.
    const quote = jest.spyOn(host, 'quoteDirectFees');
    const review = await prepare(wallet);
    expect(await quote.mock.results[0].value).toMatchObject({ nonce: '8' });
    pending = '0x9';
    expect(await live.getTransactionCount(ADDRESS, 'pending')).toBe(7);
    await expect(
      wallet.submitPrivacyWithdrawal(review.intentId)
    ).rejects.toThrow();
    expect(vault.reserveWithdrawalAttempt).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
    expect(
      requests.filter((method) => method === 'eth_getTransactionCount')
    ).toHaveLength(3);
  } finally {
    live.destroy();
    jest.useRealTimers();
  }
});

it('refuses watch-only Direct preparation before note access, proof or fee reads', async () => {
  const { wallet, state, host, provider, vault } = setup();
  selectImportedAccount(state);
  await expect(prepare(wallet)).rejects.toThrow(
    'privacy_withdrawal_context_changed'
  );
  expect(vault.withWithdrawalNote).not.toHaveBeenCalled();
  expect(host.prove).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
  expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  // Reading a saved withdrawal remains available to watch-only accounts.
  await expect(
    wallet.getPrivacyWithdrawalStatus(NOTE_ID)
  ).resolves.toMatchObject({
    noteId: NOTE_ID,
    phase: 'unknown',
  });
});

it('allows an imported signing account to prepare and submit Direct withdrawal', async () => {
  const { wallet, state, events } = setup();
  selectImportedAccount(state, 'synthetic-encrypted-key');
  const review = await prepare(wallet);
  expect(review.account.type).toBe(KeyringAccountType.Imported);
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).resolves.toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(events).toEqual(['reserve', 'send', 'record']);
});

it.each(['preparation', 'confirmation'] as const)(
  'refuses Direct %s after the imported signing capability disappears',
  async (phase) => {
    const { wallet, state, host, vault } = setup();
    const account = selectImportedAccount(state, 'synthetic-encrypted-key');
    if (phase === 'preparation') {
      const entered = deferred(),
        release = deferred();
      const prove = jest.mocked(host.prove!).getMockImplementation()!;
      jest
        .mocked(host.prove!)
        .mockImplementationOnce(async (request, options) => {
          entered.resolve();
          await release.promise;
          return prove(request, options);
        });
      const preparing = prepare(wallet);
      const rejected = expect(preparing).rejects.toThrow(
        'privacy_withdrawal_context_changed'
      );
      await entered.promise;
      account.xprv = '';
      release.resolve();
      await rejected;
    } else {
      const review = await prepare(wallet);
      account.xprv = '';
      await expect(
        wallet.submitPrivacyWithdrawal(review.intentId)
      ).rejects.toMatchObject({
        message: 'privacy_withdrawal_context_changed',
        transactionNotBroadcast: true,
      });
    }
    expect(vault.reserveWithdrawalAttempt).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  }
);

it('carries the actual controller cloned context through fixed-gas Main preparation, reservation and sender', async () => {
  const { wallet, provider, vault, host, events } = setup();
  let retainedMetadata: Readonly<Record<string, unknown>> | undefined;
  const originalSend = wallet.sendAndSaveEthTransaction.getMockImplementation();
  wallet.sendAndSaveEthTransaction.mockImplementationOnce(async (...args) => {
    const [transaction, , , , options] = args;
    const context = options.expectedContext;
    retainedMetadata = captureGenericEvmFeeDispatch(wallet, {
      operation: 'send',
      account: context.account,
      network: {
        kind: 'ethereum',
        chainId: context.chainId,
        url: context.rpcUrl,
        slip44: context.slip44,
      },
      walletNonce: options.dappNonceApproval,
      review: {
        id: options.genericDispatchId,
        unsignedHash: Transaction.from(
          serializePreparedEvmTransaction(transaction)
        ).unsignedHash,
      },
    })?.metadata;
    return originalSend(...args);
  });
  const review = await prepare(wallet);
  expect(review).toMatchObject({
    intentId: INTENT_ID,
    account: { id: 0, address: ADDRESS },
    gasLimit: '650000',
    maxNetworkFeeWei: '65000000',
    receiveWei: '1000000000000000000',
    feeWei: '0',
  });
  expect(JSON.stringify(review)).not.toContain(NOTE);
  expect(JSON.stringify(review)).not.toContain(PROOF);
  expect(JSON.stringify(review)).not.toContain(IDENTITY.nullifierHash);
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).resolves.toMatchObject({ phase: 'submitted', transactionHash: HASH });
  expect(events).toEqual(['reserve', 'send', 'record']);
  expect(retainedMetadata).toMatchObject({
    privateWithdrawal: {
      noteId: NOTE_ID,
      proof: PROOF,
      nullifierHash: IDENTITY.nullifierHash,
      mode: 'direct',
      transaction: { gasLimit: '0x9eb10', nonce: '0x7' },
    },
  });
  const [attempt, session] = vault.reserveWithdrawalAttempt.mock.calls[0];
  expect(attempt.context).not.toBe((host.captureSession() as any).context);
  expect(attempt.context.account).toEqual({
    id: 0,
    type: KeyringAccountType.HDAccount,
    address: ADDRESS,
  });
  expect(session.keyring).toBe(wallet.getActiveKeyring());
  expect(vault.recordWithdrawalSubmission).toHaveBeenCalledWith(
    attempt,
    { transactionHash: HASH },
    expect.objectContaining({
      keyring: session.keyring,
      generation: session.generation,
    })
  );
  const [transaction, legacy, account, metadata, options] =
    wallet.sendAndSaveEthTransaction.mock.calls[0];
  expect(transaction).toMatchObject({
    chainId: '1',
    from: ADDRESS,
    to: expect.stringMatching(new RegExp(PRIVACY_POOLS[1].address, 'i')),
    value: '0',
    gasLimit: '650000',
    nonce: '7',
    maxFeePerGas: '100',
    maxPriorityFeePerGas: '1',
  });
  expect(legacy).toBe(false);
  expect(account).toBeUndefined();
  expect(options.dappNonceApproval).toEqual({ nonce: 7, source: 'automatic' });
  expect(options.genericDispatchId).toEqual(expect.any(String));
  expect(metadata).toBeUndefined();
  expect(options.expectedContext).toEqual(attempt.context);
  expect(options.clearNavigation).toBe(false);
  const decoded = ABI.parseTransaction({ data: transaction.data });
  expect(Array.from(decoded!.args)).toEqual([
    PROOF,
    ROOT,
    IDENTITY.nullifierHash,
    RECIPIENT,
    `0x${'00'.repeat(20)}`,
    BigInt(0),
    BigInt(0),
  ]);
  expect(provider.estimateGas).not.toHaveBeenCalled();
  expect(provider.call).not.toHaveBeenCalled();
  expect(
    provider.send.mock.calls.some(
      ([method]) => method === 'eth_estimateGas' || method === 'eth_call'
    )
  ).toBe(false);
  expect(JSON.stringify(provider.send.mock.calls)).not.toContain(PROOF);
  expect(JSON.stringify(provider.send.mock.calls)).not.toContain(
    IDENTITY.nullifierHash
  );
  expect(
    provider.send.mock.calls.filter(
      ([method]) => method === 'eth_getTransactionCount'
    ).length
  ).toBeGreaterThanOrEqual(2);
  expect(provider.getTransactionCount).not.toHaveBeenCalled();
});

it.each([
  ['EIP-1559', { maxFeePerGas: BigInt(100), maxPriorityFeePerGas: BigInt(1) }],
  ['legacy', { gasPrice: BigInt(100) }],
])(
  'accepts the exact %s fee balance boundary and rejects one wei short',
  async (_label, fees) => {
    const { host, provider } = setup();
    provider.getFeeData.mockResolvedValue(fees as any);
    const session = host.captureSession();
    await expect(host.quoteDirectFees(session)).resolves.toMatchObject({
      gasLimit: '650000',
      nonce: '7',
    });
    provider.getBalance.mockResolvedValue(BigInt(64999999));
    await expect(host.quoteDirectFees(session)).rejects.toThrow(
      'privacy_withdrawal_insufficient_funds'
    );
    expect(provider.estimateGas).not.toHaveBeenCalled();
    expect(provider.call).not.toHaveBeenCalled();
  }
);

it.each(['getFeeData', 'pendingNonce', 'getBalance'] as const)(
  'rejects an account change while %s is outstanding before exposing a review',
  async (method) => {
    const { wallet, provider, pendingNonce, state, vault } = setup();
    const entered = deferred(),
      release = deferred();
    const target = method === 'pendingNonce' ? pendingNonce : provider[method];
    const original = target.getMockImplementation()!;
    target.mockImplementationOnce((async (...args: unknown[]) => {
      entered.resolve();
      await release.promise;
      return (original as any)(...args);
    }) as any);
    const pending = prepare(wallet);
    const failure = expect(pending).rejects.toThrow(
      'privacy_withdrawal_failed'
    );
    await entered.promise;
    state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
    release.resolve();
    await failure;
    expect(vault.reserveWithdrawalAttempt).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  }
);

it.each(['network', 'profile ABA', 'provider'] as const)(
  'rejects a %s change after public fee observation',
  async (change) => {
    const { wallet, provider, state } = setup();
    provider.getFeeData.mockImplementationOnce(async () => {
      if (change === 'network')
        state.vault.activeNetwork.url = 'https://other.example';
      else if (change === 'profile ABA') wallet.walletSessionGeneration += 2;
      else wallet.ethereumTransaction.web3Provider = { ...provider };
      return { maxFeePerGas: BigInt(100), maxPriorityFeePerGas: BigInt(1) };
    });
    await expect(prepare(wallet)).rejects.toThrow();
    expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  }
);

it('rejects a changed nonce before reserving or sending an already reviewed withdrawal', async () => {
  const { wallet, pendingNonce, vault } = setup();
  const review = await prepare(wallet);
  pendingNonce.mockResolvedValue(8);
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).rejects.toThrow();
  expect(vault.reserveWithdrawalAttempt).not.toHaveBeenCalled();
  expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});

it('waits for durable reservation, then rechecks account context before invoking the sender', async () => {
  const { wallet, vault, state, events } = setup();
  const review = await prepare(wallet);
  const entered = deferred(),
    release = deferred();
  vault.reserveWithdrawalAttempt.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    events.push('reserve');
  });
  const pending = wallet.submitPrivacyWithdrawal(review.intentId);
  const failure = expect(pending).rejects.toThrow();
  await entered.promise;
  expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
  release.resolve();
  await failure;
  expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});

it('journals a successful acknowledgement to the original attempt when the selected account changes during send', async () => {
  const { wallet, state, vault } = setup();
  const review = await prepare(wallet);
  wallet.sendAndSaveEthTransaction.mockImplementationOnce(
    async (_tx, _legacy, _account, _metadata, options) => {
      options.assertCurrentContext();
      state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
      wallet.walletSessionGeneration++;
      await options.onBroadcast({ hash: HASH });
      return { hash: HASH };
    }
  );
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).resolves.toMatchObject({ phase: 'submitted', transactionHash: HASH });
  const [attempt, , session] = vault.recordWithdrawalSubmission.mock.calls[0];
  expect(attempt.context.account.id).toBe(0);
  expect(session.keyring).toBe(
    vault.reserveWithdrawalAttempt.mock.calls[0][1].keyring
  );
  expect(session).not.toBe(vault.reserveWithdrawalAttempt.mock.calls[0][1]);
  expect(vault.clearUnbroadcastWithdrawalAttempt).not.toHaveBeenCalled();
});

it('preserves an acknowledgement already in flight when the privacy service changes', async () => {
  const { wallet, vault } = setup();
  const review = await prepare(wallet);
  const entered = deferred(),
    release = deferred();
  wallet.sendAndSaveEthTransaction.mockImplementationOnce(
    async (_tx, _legacy, _account, _metadata, options) => {
      options.assertCurrentContext();
      entered.resolve();
      await release.promise;
      await options.onBroadcast({ hash: HASH });
      return { hash: HASH };
    }
  );
  const pending = wallet.submitPrivacyWithdrawal(review.intentId);
  await entered.promise;
  await wallet.invalidatePrivacyServiceWithdrawals();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    phase: 'submitted',
    transactionHash: HASH,
  });
  expect(vault.recordWithdrawalSubmission).toHaveBeenCalledTimes(1);
  expect(vault.clearUnbroadcastWithdrawalAttempt).not.toHaveBeenCalled();
});

it('retains an unknown reserved attempt when a broadcast acknowledgement arrives after lock', async () => {
  const { wallet, keyring, vault } = setup();
  const review = await prepare(wallet);
  wallet.sendAndSaveEthTransaction.mockImplementationOnce(
    async (_tx, _legacy, _account, _metadata, options) => {
      options.assertCurrentContext();
      wallet.walletSessionGeneration++;
      keyring.isUnlocked.mockReturnValue(false);
      await options.onBroadcast({ hash: HASH });
      return { hash: HASH };
    }
  );
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).resolves.toMatchObject({ phase: 'unknown', transactionHash: HASH });
  expect(vault.reserveWithdrawalAttempt).toHaveBeenCalledTimes(1);
  expect(vault.recordWithdrawalSubmission).not.toHaveBeenCalled();
  expect(vault.clearUnbroadcastWithdrawalAttempt).not.toHaveBeenCalled();
  await expect(wallet.submitPrivacyWithdrawal(review.intentId)).rejects.toThrow(
    'privacy_withdrawal_intent_expired'
  );
  expect(wallet.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
});

it('reads a saved direct unknown status through the cloned Main binding without RPC or plaintext', async () => {
  const { wallet, vault, provider } = setup();
  const result = await wallet.getPrivacyWithdrawalStatus(NOTE_ID);
  expect(result).toEqual({ noteId: NOTE_ID, mode: 'direct', phase: 'unknown' });
  expect(vault.getWithdrawalAttempt).toHaveBeenCalledTimes(1);
  expect(vault.getWithdrawalAttempt.mock.calls[0][1].keyring).toBe(
    wallet.getActiveKeyring()
  );
  expect(provider.send).not.toHaveBeenCalled();
  expect(provider.getFeeData).not.toHaveBeenCalled();
  expect(provider.call).not.toHaveBeenCalled();
  expect(provider.estimateGas).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(NOTE);
  expect(JSON.stringify(result)).not.toContain(HASH);
});

it('rejects a saved status read if account changes while the encrypted journal is read', async () => {
  const { wallet, vault, state, provider } = setup();
  const entered = deferred(),
    release = deferred();
  const original = vault.getWithdrawalAttempt.getMockImplementation()!;
  vault.getWithdrawalAttempt.mockImplementationOnce(async (id, session) => {
    entered.resolve();
    await release.promise;
    return original(id, session);
  });
  const pending = wallet.getPrivacyWithdrawalStatus(NOTE_ID);
  const failure = expect(pending).rejects.toThrow('privacy_withdrawal_failed');
  await entered.promise;
  state.vault.activeAccount = { id: 1, type: KeyringAccountType.HDAccount };
  release.resolve();
  await failure;
  expect(provider.send).not.toHaveBeenCalled();
});

it('quotes relayer gas from chain and public fees only, without recipient or note reads', async () => {
  const { host, provider } = setup();
  await expect(host.quoteRelayerGasPrice(host.captureSession())).resolves.toBe(
    '100'
  );
  expect(provider.send.mock.calls).toEqual([['eth_chainId', []]]);
  expect(provider.getFeeData).toHaveBeenCalledTimes(1);
  expect(provider.getBalance).not.toHaveBeenCalled();
  expect(provider.getTransactionCount).not.toHaveBeenCalled();
  expect(provider.call).not.toHaveBeenCalled();
  expect(provider.estimateGas).not.toHaveBeenCalled();
});

it.each([
  'session invalidation after commit',
  'session invalidation after commit when cleanup is unavailable',
  'healthy pre-sign invalidation',
  'sender entered with unknown outcome',
] as const)('real Main host and vault reservation: %s', async (scenario) => {
  const { createPrivateVaultController } = await import('./privateVault');
  const ActualKeyring = jest.requireActual(
    '@sidhujag/sysweb3-keyring'
  ).KeyringManager;
  const keyring: any = Object.create(ActualKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  let testRoot = 'synthetic private vault test root';
  keyring.getDecryptedMnemonic = () => testRoot;
  keyring.isUnlocked = () => true;
  keyring.captureUnlockedSessionGuard = () => () => undefined;
  const run = setup();
  Object.defineProperty(keyring, 'ethereumTransaction', {
    configurable: true,
    value: run.wallet.ethereumTransaction,
  });
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
  const review = await prepare(run.wallet);
  const committed = deferred(),
    release = deferred();
  const invalidatedAfterCommit = scenario.startsWith(
    'session invalidation after commit'
  );
  const cleanupUnavailable =
    scenario ===
    'session invalidation after commit when cleanup is unavailable';
  if (invalidatedAfterCommit) {
    const write = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementationOnce(async (key, value) => {
      await write(key, value);
      committed.resolve();
      await release.promise;
    });
  } else if (scenario === 'healthy pre-sign invalidation') {
    const reserve = vault.reserveWithdrawalAttempt.bind(vault);
    jest
      .spyOn(vault, 'reserveWithdrawalAttempt')
      .mockImplementation(async (...args) => {
        await reserve(...args);
        run.snapshotGuard.mockImplementation(() => {
          throw new Error('privacy_verification_pending');
        });
      });
  }
  if (scenario === 'sender entered with unknown outcome')
    run.wallet.sendAndSaveEthTransaction.mockImplementation(
      async (_tx, _legacy, _account, _metadata, options) => {
        markGenericEvmFeeSdkEntered(run.wallet, options.genericDispatchId);
        throw new Error('transport indeterminate');
      }
    );
  const clear = jest.spyOn(vault, 'clearUnbroadcastWithdrawalAttempt');
  if (cleanupUnavailable)
    clear.mockRejectedValueOnce(new Error('Synthetic cleanup storage refusal'));
  const result = run.controller.submitWithdrawal(review.intentId);
  const outcome =
    scenario === 'sender entered with unknown outcome'
      ? expect(result).resolves.toMatchObject({ phase: 'unknown' })
      : expect(result).rejects.toMatchObject({ transactionNotBroadcast: true });
  if (invalidatedAfterCommit) {
    await committed.promise;
    expect(run.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
    run.wallet.walletSessionGeneration += 1;
    release.resolve();
  }
  await outcome;
  if (scenario === 'sender entered with unknown outcome')
    expect(run.wallet.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  else expect(run.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  const session = run.wallet.capturePrivateVaultSession();
  const saved = await vault.getWithdrawalAttempt(NOTE_ID, session);
  if (cleanupUnavailable) {
    expect(clear).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ phase: 'unknown' });
    expect((await vault.getNotes()).notes[0].phase).toBe('waiting');
    run.state.vault.activeAccount = {
      id: 1,
      type: KeyringAccountType.HDAccount,
    };
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
    run.state.vault.activeAccount = {
      id: 0,
      type: KeyringAccountType.HDAccount,
    };
    run.state.vault.activeNetwork.url = 'https://other.example';
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
    run.state.vault.activeNetwork.url = 'https://operator.example';
    testRoot = 'different profile root';
    expect((await run.wallet.getPrivateVaultNotes()).notes).toHaveLength(0);
    testRoot = 'synthetic private vault test root';
    const capability = run.wallet.knownUnbroadcast;
    const bound = capability.get(review.intentId);
    capability.set(review.intentId, {
      ...bound,
      attemptHash: '0x' + 'ff'.repeat(32),
    });
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
    capability.set(review.intentId, bound);
    run.wallet.knownUnbroadcast = new Map(); // Simulate worker memory loss.
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
    run.wallet.knownUnbroadcast = new Map([
      ['stale', { ...bound, attemptHash: '0x' + 'ff'.repeat(32) }],
      [review.intentId, bound],
    ]);
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'verified'
    );
    expect(run.wallet.knownUnbroadcast.has('stale')).toBe(true);
    expect(run.wallet.knownUnbroadcast.has(review.intentId)).toBe(false);
    expect(await vault.getWithdrawalAttempt(NOTE_ID, session)).toBeNull();
  } else if (scenario === 'sender entered with unknown outcome') {
    expect(clear).not.toHaveBeenCalled();
    expect(saved).toMatchObject({ phase: 'unknown' });
    expect((await run.wallet.getPrivateVaultNotes()).notes[0].phase).toBe(
      'waiting'
    );
  } else {
    expect(clear).toHaveBeenCalledTimes(1);
    expect(saved).toBeNull();
    expect((await vault.getNotes()).notes[0].phase).toBe('verified');
  }
});

it.each([
  ['withdrawal', 'before-sign'],
  ['withdrawal', 'after-broadcast'],
  ['deposit', 'before-sign'],
  ['deposit', 'after-broadcast'],
] as const)(
  'actual Main %s host fences restore %s and retains acknowledged outcomes',
  async (kind, stage) => {
    const { createPrivateVaultController } = await import('./privateVault');
    const { createPrivacyTransactionsController } = await import(
      '../../../wallet/privacyTransactions'
    );
    const ActualKeyring = jest.requireActual(
      '@sidhujag/sysweb3-keyring'
    ).KeyringManager;
    const keyring: any = Object.create(ActualKeyring.prototype);
    keyring.sessionPassword = { isCleared: () => false };
    keyring.sessionMnemonic = { isCleared: () => false };
    keyring.privateRecordSessionRevision = 0;
    keyring.getDecryptedMnemonic = () => 'synthetic restore host race wallet';
    keyring.isUnlocked = () => true;
    keyring.captureUnlockedSessionGuard = () => () => undefined;
    const run = setup();
    Object.defineProperty(keyring, 'ethereumTransaction', {
      configurable: true,
      value: run.wallet.ethereumTransaction,
    });
    run.wallet.getActiveKeyring = () => keyring;
    run.wallet.getWalletSetupStatus = () => undefined;
    run.wallet.privacyDepositContexts = new WeakMap();
    run.provider.getBalance.mockResolvedValue(BigInt('2000000000000000000'));
    (run.provider.estimateGas as jest.Mock).mockImplementation(() =>
      Promise.resolve(BigInt(100001))
    );
    if (kind === 'deposit') {
      Object.defineProperty(run.provider, 'signal', {
        value: new AbortController().signal,
      });
      Object.assign(run.provider, {
        getGasPrice: jest.fn(async () => BigInt(5)),
        verifyConfiguredChainId: jest.fn(async () => undefined),
      });
      const originalRead = run.provider.send.getMockImplementation()!;
      run.provider.send.mockImplementation(async (method, params) => {
        if (method === 'eth_getBlockByNumber')
          return {
            hash: '0x' + 'aa'.repeat(32),
            number: '0x10',
            gasLimit: '0x1c9c380',
            baseFeePerGas: '0x2',
          } as any;
        if (method === 'eth_estimateGas')
          return '0x' + BigInt(await run.provider.estimateGas()).toString(16);
        if (method === 'eth_getBalance')
          return '0x' + (await run.provider.getBalance()).toString(16);
        if (method === 'eth_maxPriorityFeePerGas') return '0x1';
        return originalRead(method, params);
      });
      run.wallet.captureFreshEvmRead = () => ({
        network: run.state.vault.activeNetwork,
        assertCurrent: () => undefined,
        overrides: {},
        run: (action: (provider: unknown) => unknown) => action(run.provider),
      });
      run.wallet.inspectOrdinaryEvmNonce = async (
        _read: unknown,
        address: string,
        options: { assertCurrent(): void }
      ) => {
        options.assertCurrent();
        const nonce = Number(
          BigInt(
            await run.provider.send('eth_getTransactionCount', [
              address,
              'pending',
            ])
          )
        );
        options.assertCurrent();
        return {
          nonce,
          state: 'pending',
          balanceState: 'pending',
          canonicalBlock: { hash: '0x' + 'aa'.repeat(32), number: '16' },
          nativeReservations: { canonical: BigInt(0), pending: BigInt(0) },
        };
      };
    }
    const records: Record<string, unknown> = {};
    let sequence = 100;
    const vault = createPrivateVaultController(
      {
        captureSession: () => run.wallet.capturePrivateVaultSession(),
        authenticate: async (_password, session, reveal) => {
          session.assertCurrent();
          return reveal();
        },
        readNote: async () => ({
          phase: kind === 'deposit' ? 'not-found' : 'verified',
        }),
      },
      {
        storage: {
          getItem: async (key) => records[key] ?? null,
          setItem: async (key, value) => {
            records[key] = structuredClone(value);
          },
        },
        mutex: new AsyncMutex(),
        now: () => 1000,
        generate: () => NOTE,
        randomId: () =>
          sequence++ === 100
            ? NOTE_ID
            : `00000000-0000-4000-8000-${sequence
                .toString(16)
                .padStart(12, '0')}`,
      }
    );
    run.wallet.getPrivateVaultController.mockResolvedValue(vault);
    const entered = deferred(),
      release = deferred();
    const signer = jest.fn(async () => {
      if (stage === 'after-broadcast') {
        entered.resolve();
        await release.promise;
      }
      return { hash: HASH, nonce: 7 };
    });
    Object.defineProperty(keyring, 'ethereumTransaction', {
      configurable: true,
      value: { web3Provider: run.provider, sendFormattedTransaction: signer },
    });
    run.wallet.sendAndSaveTransaction = jest.fn(async () => undefined);
    run.wallet.sendAndSaveEthTransaction =
      MainController.prototype.sendAndSaveEthTransaction.bind(run.wallet);
    jest.mocked(getController).mockReturnValue({ wallet: run.wallet } as any);
    let review: { intentId: string };
    if (kind === 'deposit') {
      run.wallet.privacyTransactionsController = Promise.resolve(
        createPrivacyTransactionsController(
          run.wallet.createPrivacyTransactionsHost(),
          { now: () => 1000, randomId: () => INTENT_ID }
        )
      );
      review = await run.wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
    } else {
      await vault.importNote(NOTE);
      review = await prepare(run.wallet);
    }
    if (stage === 'before-sign')
      jest
        .mocked(getBlacklistTargetsForEvmCallWithContractType)
        .mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return [];
        });
    const result = (
      kind === 'deposit'
        ? run.wallet.submitPrivacyDeposit(review.intentId)
        : run.wallet.submitPrivacyWithdrawal(review.intentId)
    ).then(
      (value: unknown) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error })
    );
    await entered.promise;
    const session = run.wallet.capturePrivateVaultSession();
    const entries = [
      { note: NOTE, createdAt: 1, reconciliationRequired: true as const },
    ];
    const plan = await vault.prepareRestore(entries, session);
    await vault.commitRestore(plan, entries, 'synthetic-password', session);
    release.resolve();
    const settled = await result;
    if (stage === 'before-sign') {
      expect(settled.error).toMatchObject({ transactionNotBroadcast: true });
      expect(signer).not.toHaveBeenCalled();
    } else {
      expect(settled.error).toBeUndefined();
      expect(settled.value).toMatchObject({
        phase: 'submitted',
        transactionHash: HASH,
      });
      const journal =
        kind === 'deposit'
          ? await vault.getDepositAttempt(NOTE_ID, session)
          : await vault.getWithdrawalAttempt(NOTE_ID, session);
      expect(journal).toMatchObject({
        phase: 'submitted',
        transactionHash: HASH,
      });
    }
    await expect(
      vault.withWithdrawalNote(NOTE_ID, session, () => 'must not return')
    ).rejects.toThrow('privacy_note_restore_required');
  }
);

function cachedChainProvider() {
  const { CustomJsonRpcProvider } = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/providers'
  );
  const live = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://operator.example',
    1
  );
  let chain = '0x1';
  const methods: string[] = [];
  live.requestRpc = jest.fn(async (calls: Array<{ method: string }>) =>
    calls.map(({ method }) => {
      methods.push(method);
      if (method === 'eth_chainId') return { jsonrpc: '2.0', result: chain };
      if (method === 'eth_getTransactionCount')
        return { jsonrpc: '2.0', result: '0x7' };
      throw new Error('Unexpected synthetic RPC');
    })
  );
  live.estimateGas = jest.fn(async () => BigInt(100001));
  live.getFeeData = jest.fn(async () => ({
    maxFeePerGas: BigInt(100),
    maxPriorityFeePerGas: BigInt(1),
  }));
  live.getBalance = jest.fn(async () => BigInt('2000000000000000000'));
  return {
    live,
    methods,
    setChain: (value: string) => {
      chain = value;
    },
  };
}

it.each(['direct', 'relayer'] as const)(
  'checks the live chain before %s withdrawal quote',
  async (kind) => {
    for (const scenario of ['changed', 'unchanged'] as const) {
      const { wallet, host } = setup();
      const { live, methods, setChain } = cachedChainProvider();
      wallet.ethereumTransaction.web3Provider = live;
      try {
        await expect(live.send('eth_chainId', [])).resolves.toBe('0x1');
        if (scenario === 'changed') setChain('0x89');
        const before = methods.length;
        await expect(live.send('eth_chainId', [])).resolves.toBe('0x1');
        expect(methods).toHaveLength(before);
        const session = host.captureSession();
        const quote =
          kind === 'direct'
            ? host.quoteDirectFees(session)
            : host.quoteRelayerGasPrice(session);
        if (scenario === 'changed') {
          await expect(quote).rejects.toThrow(
            'privacy_withdrawal_context_changed'
          );
          expect(live.getFeeData).not.toHaveBeenCalled();
        } else if (kind === 'direct') {
          await expect(quote).resolves.toMatchObject({ nonce: '7' });
        } else await expect(quote).resolves.toBe('100');
      } finally {
        live.destroy();
      }
    }
  }
);

it.each(['lock-unlock', 'wallet-reset', 'keyring-replacement'] as const)(
  'does not journal an old withdrawal ACK after %s',
  async (change) => {
    const run = setup();
    const review = await prepare(run.wallet);
    run.wallet.sendAndSaveEthTransaction.mockImplementationOnce(
      async (_tx, _legacy, _account, _metadata, options) => {
        if (change === 'lock-unlock') {
          await run.keyring.lockWallet();
          run.keyring.isUnlocked.mockReturnValue(true);
        } else if (change === 'wallet-reset')
          run.wallet.walletStateGeneration++;
        else run.wallet.getActiveKeyring = () => ({ ...run.keyring });
        await options.onBroadcast({ hash: HASH });
        return { hash: HASH };
      }
    );
    await expect(
      run.wallet.submitPrivacyWithdrawal(review.intentId)
    ).resolves.toMatchObject({ phase: 'unknown', transactionHash: HASH });
    expect(run.vault.recordWithdrawalSubmission).not.toHaveBeenCalled();
    expect(run.vault.clearUnbroadcastWithdrawalAttempt).not.toHaveBeenCalled();
  }
);
