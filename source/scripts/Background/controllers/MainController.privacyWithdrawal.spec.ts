jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
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
import { Interface } from 'ethers';

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
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
    now: () => 1000,
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
  };
}
const prepare = (wallet: any) =>
  wallet.preparePrivacyWithdrawal({
    noteId: NOTE_ID,
    recipient: RECIPIENT,
    mode: 'direct',
  });

beforeEach(() => {
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
        throw new Error('Unexpected synthetic read');
      return { result: method === 'eth_chainId' ? '0x1' : pending };
    })
  );
  live.getFeeData = jest.fn(async () => ({
    maxFeePerGas: BigInt(100),
    maxPriorityFeePerGas: BigInt(1),
  }));
  live.getBalance = jest.fn(async () => BigInt(65000000));
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

it('carries the actual controller cloned context through fixed-gas Main preparation, reservation and sender', async () => {
  const { wallet, provider, vault, host, events } = setup();
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
    session
  );
  const [transaction, legacy, account, metadata, options] =
    wallet.sendAndSaveEthTransaction.mock.calls[0];
  expect(transaction).toMatchObject({
    chainId: 1,
    from: ADDRESS,
    to: PRIVACY_POOLS[1].address,
    value: '0x0',
    gasLimit: '0x9eb10',
    nonce: '0x7',
    maxFeePerGas: '0x64',
    maxPriorityFeePerGas: '0x1',
  });
  expect(legacy).toBe(false);
  expect(account).toEqual({ id: 0, type: KeyringAccountType.HDAccount });
  expect(metadata).toBeUndefined();
  expect(options.expectedContext).toBe(attempt.context);
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
  expect(provider.send.mock.calls).toEqual([
    ['eth_chainId', []],
    ['eth_getTransactionCount', [ADDRESS, 'pending']],
    ['eth_getTransactionCount', [ADDRESS, 'pending']],
  ]);
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
      await options.onBroadcast({ hash: HASH });
      return { hash: HASH };
    }
  );
  await expect(
    wallet.submitPrivacyWithdrawal(review.intentId)
  ).resolves.toMatchObject({ phase: 'submitted', transactionHash: HASH });
  const [attempt, , session] = vault.recordWithdrawalSubmission.mock.calls[0];
  expect(attempt.context.account.id).toBe(0);
  expect(session).toBe(vault.reserveWithdrawalAttempt.mock.calls[0][1]);
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
