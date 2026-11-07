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

import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import * as privacyClient from 'utils/privacy/client';
import * as completion from 'utils/privacy/spentCompletion';
import type { IPrivacyTransactionsHost } from 'utils/privacy/transactionTypes';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';
import { createPrivacyTransactionsController } from './privacyTransactions';
import type { IPrivateVaultSession } from './privateVault';
import { forgetWalletWithRecovery } from './walletRecovery';

const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const PROFILE_KEY = `state-private-vault-v1:0x${'ab'.repeat(32)}`;
const DEPOSIT_HASH = '0x' + 'ab'.repeat(32);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture() {
  const keyring = {
    isUnlocked: jest.fn(() => true),
    unlock: jest.fn(async () => ({ canLogin: true })),
    lockWallet: jest.fn(async () => undefined),
  };
  const wallet: any = Object.create(MainController.prototype);
  Object.assign(wallet, {
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    authenticationMutex: new AsyncMutex(),
    getActiveKeyring: () => keyring,
    prepareWalletRecoveryAccess: jest.fn(async () => undefined),
    checkRateLimit: jest.fn(async () => 0),
    resetRateLimit: jest.fn(async () => undefined),
    recordFailedAttempt: jest.fn(async () => undefined),
  });
  return { wallet, keyring };
}

function depositFixture() {
  const { wallet, keyring } = fixture();
  const state: any = structuredClone(store.getState());
  state.vault.activeNetwork = {
    kind: 'ethereum',
    chainId: 1,
    url: 'https://operator.example',
  };
  state.vault.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
  state.vault.accounts = {
    [KeyringAccountType.HDAccount]: {
      0: { id: 0, address: '0x' + '11'.repeat(20) },
      1: { id: 1, address: '0x' + '22'.repeat(20) },
    },
  };
  state.vault.isBitcoinBased = false;
  state.vaultGlobal.activeSlip44 = 60;
  jest.spyOn(store, 'getState').mockImplementation(() => state);
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
    estimateGas: jest.fn(async () => BigInt(100001)),
    getFeeData: jest.fn(async () => ({
      maxFeePerGas: BigInt(100),
      maxPriorityFeePerGas: BigInt(1),
    })),
    getTransactionCount: jest.fn(() => {
      throw new Error('Cached pending nonce must not be used');
    }),
    getBalance: jest.fn(async () => BigInt('2000000000000000000')),
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
    prepareDepositNote: jest.fn(
      async (poolId, noteId, session: IPrivateVaultSession) => {
        session.assertCurrent();
        return { id: noteId || '00000000-0000-4000-8000-000000001000', poolId };
      }
    ),
    withDepositCommitment: jest.fn(async (_id, _session, use) =>
      use('0x' + '01'.repeat(32))
    ),
    reserveDepositAttempt: jest.fn(
      async (_attempt, _session, onRestoreFence) => {
        onRestoreFence(() => undefined);
      }
    ),
    recordDepositBroadcast: jest.fn(async () => undefined),
    clearUnbroadcastDepositAttempt: jest.fn(async () => undefined),
  };
  Object.assign(wallet, {
    privacyDepositSessions: new WeakMap(),
    privacyDepositContexts: new WeakMap(),
    assertWalletReadyForSigning: jest.fn(),
    getPrivateVaultController: jest.fn(async () => vault),
    sendAndSaveEthTransaction: jest.fn(
      async (_tx, _legacy, _target, _metadata, options) => {
        options.assertBeforeSign?.();
        await options.onBroadcast({ hash: DEPOSIT_HASH });
        return { hash: DEPOSIT_HASH };
      }
    ),
  });
  Object.defineProperty(wallet, 'ethereumTransaction', {
    configurable: true,
    value: { web3Provider: provider },
  });
  wallet.privacyTransactionsController = Promise.resolve(
    createPrivacyTransactionsController(
      wallet.createPrivacyTransactionsHost(),
      {
        now: () => 1000,
        randomId: () => '00000000-0000-4000-8000-000000000001',
      }
    )
  );
  return { wallet, keyring, state, provider, pendingNonce, vault };
}

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
  global.chrome = originalChrome;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  walletPersistenceGate.blocked = false;
  jest.restoreAllMocks();
});

it('authenticates reveal through the existing password rate limit without exporting the seed', async () => {
  const { wallet, keyring } = fixture();
  const reveal = jest.fn(async () => 'synthetic-private-note');
  await expect(
    wallet.authenticatePrivateVault(
      'password',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).resolves.toBe('synthetic-private-note');
  expect(keyring.unlock).toHaveBeenCalledWith('password');
  expect(wallet.checkRateLimit).toHaveBeenCalledTimes(1);
  expect(wallet.resetRateLimit).toHaveBeenCalledTimes(1);
  expect(reveal).toHaveBeenCalledTimes(1);
});

it('counts one incorrect password and releases no note', async () => {
  const { wallet, keyring } = fixture();
  keyring.unlock.mockResolvedValueOnce({ canLogin: false });
  const reveal = jest.fn(async () => 'synthetic-private-note');
  await expect(
    wallet.authenticatePrivateVault(
      'wrong',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).rejects.toThrow('Invalid password');
  expect(wallet.recordFailedAttempt).toHaveBeenCalledTimes(1);
  expect(reveal).not.toHaveBeenCalled();
});

it('enforces an existing password lockout before invoking the keyring or reading ciphertext', async () => {
  const { wallet, keyring } = fixture();
  wallet.checkRateLimit.mockResolvedValueOnce(42);
  const reveal = jest.fn();
  await expect(
    wallet.authenticatePrivateVault(
      'wrong',
      wallet.capturePrivateVaultSession(),
      reveal
    )
  ).rejects.toThrow(
    'Too many failed attempts. Please wait 42 seconds before trying again.'
  );
  expect(keyring.unlock).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});

it('rejects reveal if the wallet locks during password verification', async () => {
  const { wallet, keyring } = fixture();
  const entered = deferred();
  const release = deferred();
  keyring.unlock.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { canLogin: true };
  });
  const reveal = jest.fn();
  const result = wallet.authenticatePrivateVault(
    'password',
    wallet.capturePrivateVaultSession(),
    reveal
  );
  const failure = expect(result).rejects.toThrow('Wallet session changed');
  await entered.promise;
  wallet.walletSessionGeneration++;
  release.resolve();
  await failure;
  expect(keyring.lockWallet).toHaveBeenCalledTimes(1);
  expect(reveal).not.toHaveBeenCalled();
});

it('rejects plaintext produced after a session change in a reveal callback', async () => {
  const { wallet } = fixture();
  await expect(
    wallet.authenticatePrivateVault(
      'password',
      wallet.capturePrivateVaultSession(),
      async () => {
        wallet.walletSessionGeneration++;
        return 'synthetic-private-note';
      }
    )
  ).rejects.toThrow('privacy_vault_session_changed');
});

it('serializes reveal and reset in authentication then persistence order', async () => {
  const { wallet } = fixture();
  const entered = deferred();
  const release = deferred();
  const events: string[] = [];
  const revealing = wallet.authenticatePrivateVault(
    'password',
    wallet.capturePrivateVaultSession(),
    () =>
      walletPersistenceMutex.runExclusive(async () => {
        events.push('reveal');
        entered.resolve();
        await release.promise;
        return 'synthetic-private-note';
      })
  );
  await entered.promise;
  wallet.forgetWalletExclusive = jest.fn(() =>
    walletPersistenceMutex.runExclusive(async () => {
      events.push('reset');
      wallet.walletSessionGeneration++;
    })
  );
  const reset = wallet.forgetWallet('password');
  expect(events).toEqual(['reveal']);
  release.resolve();
  await revealing;
  await reset;
  expect(events).toEqual(['reveal', 'reset']);
});

it('does not load the custody chunk while locked or restoring wallet state', async () => {
  const { wallet, keyring } = fixture();
  const load = jest.spyOn(wallet, 'getPrivateVaultController');
  keyring.isUnlocked.mockReturnValue(false);
  await expect(wallet.getPrivateVaultNotes()).rejects.toThrow(
    'privacy_vault_locked'
  );
  keyring.isUnlocked.mockReturnValue(true);
  wallet.recoveryJournalPending = true;
  await expect(
    wallet.importPrivateVaultNote('synthetic-private-note')
  ).rejects.toThrow('privacy_vault_unavailable');
  expect(load).not.toHaveBeenCalled();
});

it('rejects a note-backup action across a delayed controller load', async () => {
  const { wallet } = fixture();
  const release = deferred();
  const begin = jest.fn(async () => 'opaque-operation');
  wallet.noteBackupController = release.promise.then(() => ({ begin }));
  const request = wallet.beginNoteBackup();
  const rejected = expect(request).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  wallet.advanceWalletSession();
  release.resolve();
  await rejected;
  expect(begin).not.toHaveBeenCalled();
});

it('revokes note-file staging synchronously when the wallet session advances', () => {
  const { wallet } = fixture();
  const events: string[] = [];
  wallet.noteBackupInvalidators = new Set([
    () => events.push(`revoked-at-${wallet.walletSessionGeneration}`),
  ]);
  wallet.advanceWalletSession();
  expect(events).toEqual(['revoked-at-1']);
});

it('drops a note-file response delivered after its session was revoked', async () => {
  const { wallet } = fixture();
  const entered = deferred();
  const release = deferred();
  const exportEncrypted = jest.fn(async () => {
    entered.resolve();
    await release.promise;
    return { id: 'opaque-operation', file: 'AQID', noteCount: 1, createdAt: 0 };
  });
  wallet.noteBackupController = Promise.resolve({ exportEncrypted });
  const request = wallet.exportEncryptedNoteBackup(
    'opaque-operation',
    'wallet',
    'file'
  );
  const rejected = expect(request).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  wallet.advanceWalletSession();
  release.resolve();
  await rejected;
});

it('allows only ID-bound cancellation after locking without loading a controller', async () => {
  const { wallet, keyring } = fixture();
  const load = jest.spyOn(wallet, 'getNoteBackupController');
  keyring.isUnlocked.mockReturnValue(false);
  await wallet.cancelNoteBackup('missing-operation');
  expect(load).not.toHaveBeenCalled();
  const cancel = jest.fn(async () => undefined);
  wallet.noteBackupController = Promise.resolve({ cancel });
  await wallet.cancelNoteBackup('owned-operation');
  expect(cancel).toHaveBeenCalledWith('owned-operation');
  await expect(wallet.beginNoteBackup()).rejects.toThrow(
    'privacy_vault_locked'
  );
  expect(load).not.toHaveBeenCalled();
});

it('never retries an ambiguous note-file commit', async () => {
  const { wallet } = fixture();
  const commitImport = jest.fn(async () => {
    throw new Error('BACKUP_COMMIT_UNCONFIRMED');
  });
  const readCommitReceipt = jest.fn(async () => null);
  wallet.noteBackupController = Promise.resolve({
    commitImport,
    readCommitReceipt,
  });
  await expect(
    wallet.commitNoteBackupImport('owned-operation', 'synthetic-password')
  ).rejects.toThrow('BACKUP_COMMIT_UNCONFIRMED');
  expect(
    await wallet.readNoteBackupCommitReceipt('owned-operation')
  ).toBeNull();
  expect(commitImport).toHaveBeenCalledTimes(1);
  expect(readCommitReceipt).toHaveBeenCalledTimes(1);
});

it('does not transfer an admitted request across a delayed chunk load', async () => {
  const { wallet } = fixture();
  const entered = deferred();
  const release = deferred();
  const getNotes = jest.fn(async () => ({ notes: [] }));
  wallet.privateVaultController = release.promise.then(() => ({ getNotes }));
  const loadController = wallet.getPrivateVaultController.bind(wallet);
  jest.spyOn(wallet, 'getPrivateVaultController').mockImplementation(() => {
    entered.resolve();
    return loadController();
  });
  const result = wallet.getPrivateVaultNotes();
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  wallet.walletSessionGeneration++;
  release.resolve();
  await failure;
  expect(getNotes).not.toHaveBeenCalled();
});

it('does not admit a notes request into a session changed before empty reconciliation settles', async () => {
  const { wallet } = fixture();
  const getNotes = jest.fn(async () => ({ notes: [] }));
  wallet.privateVaultController = Promise.resolve({ getNotes });
  const result = wallet.getPrivateVaultNotes();
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  wallet.walletSessionGeneration++;
  await failure;
  expect(getNotes).not.toHaveBeenCalled();
});

it('does not transfer a notes request when the session changes during reconciliation', async () => {
  const { wallet, keyring } = fixture();
  const entered = deferred();
  const release = deferred();
  const getNotes = jest.fn(async () => ({ notes: [] }));
  wallet.privateVaultController = Promise.resolve({ getNotes });
  wallet.knownUnbroadcast = new Map([['synthetic-attempt', {}]]);
  wallet.capturePrivacyDepositContext = jest.fn(() => ({
    context: {},
    assertCurrent: jest.fn(),
  }));
  Object.assign(keyring, {
    getPrivateRecordProfileId: jest.fn(async () => {
      entered.resolve();
      await release.promise;
      return 'synthetic-profile';
    }),
  });
  const result = wallet.getPrivateVaultNotes();
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
  await entered.promise;
  wallet.walletSessionGeneration++;
  release.resolve();
  await failure;
  expect(getNotes).not.toHaveBeenCalled();
});

it('checks the session again after controller responses', async () => {
  const { wallet } = fixture();
  wallet.privateVaultController = Promise.resolve({
    revealNote: async () => {
      wallet.walletSessionGeneration++;
      return 'synthetic-private-note';
    },
  });
  await expect(wallet.revealPrivateVaultNote('id', 'password')).rejects.toThrow(
    'privacy_vault_session_changed'
  );
});

it('uses fresh deposit nonce observations while the actual SDK read cache still holds an earlier nonce', async () => {
  jest.useFakeTimers();
  const { CustomJsonRpcProvider } = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/providers'
  );
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    'https://synthetic.invalid',
    1
  );
  let nonce = '0x7';
  provider.requestRpc = jest.fn(async (calls: Array<{ method: string }>) =>
    calls.map(({ method }) => {
      if (method !== 'eth_getTransactionCount' && method !== 'eth_chainId')
        throw new Error('Unexpected synthetic read');
      return {
        jsonrpc: '2.0',
        result: method === 'eth_chainId' ? '0x1' : nonce,
      };
    })
  );
  provider.estimateGas = jest.fn(async () => BigInt(100000));
  provider.getFeeData = jest.fn(async () => ({
    maxFeePerGas: BigInt(100),
    maxPriorityFeePerGas: BigInt(1),
  }));
  provider.getBalance = jest.fn(async () => BigInt('2000000000000000000'));
  const { wallet, vault } = depositFixture();
  wallet.ethereumTransaction.web3Provider = provider;
  try {
    const address = store.getState().vault.accounts.HDAccount[0].address;
    expect(await provider.getTransactionCount(address, 'pending')).toBe(7);
    nonce = '0x8';
    expect(await provider.getTransactionCount(address, 'pending')).toBe(7);
    const review = await wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
    expect(review.nonce).toBe('8');
    nonce = '0x9';
    expect(await provider.getTransactionCount(address, 'pending')).toBe(7);
    await expect(wallet.submitPrivacyDeposit(review.intentId)).rejects.toThrow(
      'privacy_deposit_submission_blocked'
    );
    expect(vault.reserveDepositAttempt).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  } finally {
    provider.destroy();
    jest.useRealTimers();
  }
});

it('preserves the captured deposit guard identity while cloning the public context for the real Main host', async () => {
  const { wallet, vault } = depositFixture();
  const host: IPrivacyTransactionsHost = wallet.createPrivacyTransactionsHost();
  const capture = jest.spyOn(host, 'captureContext');
  const prepareNote = jest.spyOn(host, 'prepareNote');
  wallet.privacyTransactionsController = Promise.resolve(
    createPrivacyTransactionsController(host, {
      now: () => 1000,
      randomId: () => '00000000-0000-4000-8000-000000000001',
    })
  );
  const review = await wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  const captured = capture.mock.results[0].value;
  const intentSession = prepareNote.mock.calls[0][2];
  expect(intentSession).not.toBe(captured);
  expect(intentSession.context).not.toBe(captured.context);
  expect(intentSession.assertCurrent).toBe(captured.assertCurrent);
  expect(vault.prepareDepositNote.mock.calls[0][2].keyring).toBe(
    wallet.getActiveKeyring()
  );
  await expect(
    wallet.submitPrivacyDeposit(review.intentId)
  ).resolves.toMatchObject({
    phase: 'submitted',
    transactionHash: DEPOSIT_HASH,
  });
});

it('prepares exact deposit gas and maximum fee through the captured provider without signing', async () => {
  const { wallet, provider, vault } = depositFixture();
  const review = await wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  expect(review).toMatchObject({
    chainId: 1,
    gasLimit: '120002',
    nonce: '7',
    maxNetworkFeeWei: '12000200',
    maxTotalWei: '1000000000012000200',
  });
  expect(provider.estimateGas).toHaveBeenCalledWith(
    expect.objectContaining({
      chainId: 1,
      from: review.account.address,
      value: '0xde0b6b3a7640000',
    })
  );
  expect(vault.reserveDepositAttempt).not.toHaveBeenCalled();
  expect(wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  const result = await wallet.submitPrivacyDeposit(review.intentId);
  expect(result).toMatchObject({
    phase: 'submitted',
    transactionHash: DEPOSIT_HASH,
  });
  expect(vault.reserveDepositAttempt).toHaveBeenCalledTimes(1);
  expect(vault.recordDepositBroadcast).toHaveBeenCalledTimes(1);
  expect(wallet.sendAndSaveEthTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ gasLimit: '0x1d4c2', nonce: '0x7' }),
    false,
    { id: 0, type: KeyringAccountType.HDAccount },
    undefined,
    expect.objectContaining({
      clearNavigation: false,
      expectedContext: expect.objectContaining({
        chainId: 1,
        rpcUrl: 'https://operator.example',
        sessionGeneration: 0,
      }),
      onBroadcast: expect.any(Function),
    })
  );
});

it('stops deposit preflight reads after account change and rejects unsupported active accounts', async () => {
  const f = depositFixture();
  f.provider.estimateGas.mockImplementationOnce(async () => {
    f.state.vault.activeAccount.id = 1;
    return BigInt(100000);
  });
  await expect(
    f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow();
  expect(f.provider.getFeeData).not.toHaveBeenCalled();
  expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  f.state.vault.activeNetwork.chainId = 57;
  await expect(
    f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow('privacy_deposit_context_invalid');
});

it.each([
  KeyringAccountType.Ledger,
  KeyringAccountType.Trezor,
  KeyringAccountType.SmartAccount,
])(
  'rejects privacy deposits from %s before note generation or RPC',
  async (type) => {
    const f = depositFixture();
    f.state.vault.accounts[type] = {
      0: {
        ...f.state.vault.accounts.HDAccount[0],
        isLedgerWallet: type === KeyringAccountType.Ledger,
        isTrezorWallet: type === KeyringAccountType.Trezor,
        isSmartAccount: type === KeyringAccountType.SmartAccount,
      },
    };
    f.state.vault.activeAccount = { id: 0, type };
    await expect(
      f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
    ).rejects.toThrow('privacy_deposit_unsupported_account');
    expect(f.vault.prepareDepositNote).not.toHaveBeenCalled();
    for (const operation of Object.values(f.provider))
      expect(operation).not.toHaveBeenCalled();
    expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  }
);

it('rejects hardware flags even on a software account record and still accepts imported software accounts', async () => {
  const f = depositFixture();
  f.state.vault.accounts.HDAccount[0].isLedgerWallet = true;
  await expect(
    f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow('privacy_deposit_unsupported_account');
  expect(f.provider.send).not.toHaveBeenCalled();
  f.state.vault.accounts.Imported = {
    0: {
      ...f.state.vault.accounts.HDAccount[0],
      isLedgerWallet: false,
      xprv: 'synthetic-private-key',
    },
  };
  f.state.vault.activeAccount = { id: 0, type: KeyringAccountType.Imported };
  expect(
    await f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).toMatchObject({ account: { type: KeyringAccountType.Imported } });
});

it('rejects changed deposit nonce or insufficient exact balance before reservation', async () => {
  const f = depositFixture();
  const review = await f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  f.pendingNonce.mockResolvedValueOnce(8);
  await expect(
    f.wallet.submitPrivacyDeposit(review.intentId)
  ).rejects.toMatchObject({ transactionNotBroadcast: true });
  expect(f.vault.reserveDepositAttempt).not.toHaveBeenCalled();
  expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  const poor = depositFixture();
  poor.provider.getBalance.mockResolvedValueOnce(BigInt('1000000000012000199'));
  await expect(
    poor.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow();
  expect(poor.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});

it('journals an acknowledged deposit against the original profile after account selection changes', async () => {
  const f = depositFixture();
  f.wallet.sendAndSaveEthTransaction.mockImplementationOnce(
    async (_tx, _legacy, _target, _metadata, options) => {
      f.state.vault.activeAccount.id = 1;
      await options.onBroadcast({ hash: DEPOSIT_HASH });
      throw Object.assign(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
        transactionHash: DEPOSIT_HASH,
      });
    }
  );
  const review = await f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  expect(await f.wallet.submitPrivacyDeposit(review.intentId)).toMatchObject({
    phase: 'submitted',
    transactionHash: DEPOSIT_HASH,
  });
  const [attempt] = (f.vault.recordDepositBroadcast as jest.Mock).mock.calls[0];
  expect(attempt.context.account.id).toBe(0);
  expect(f.vault.clearUnbroadcastDepositAttempt).not.toHaveBeenCalled();
});

it('retains unknown deposit state if the original session locks before hash journaling', async () => {
  const f = depositFixture();
  f.wallet.sendAndSaveEthTransaction.mockImplementationOnce(
    async (_tx, _legacy, _target, _metadata, options) => {
      f.wallet.walletSessionGeneration++;
      await options.onBroadcast({ hash: DEPOSIT_HASH });
      return { hash: DEPOSIT_HASH };
    }
  );
  const review = await f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  expect(await f.wallet.submitPrivacyDeposit(review.intentId)).toMatchObject({
    phase: 'unknown',
    transactionHash: DEPOSIT_HASH,
  });
  expect(f.vault.recordDepositBroadcast).not.toHaveBeenCalled();
  expect(f.vault.clearUnbroadcastDepositAttempt).not.toHaveBeenCalled();
});

it.each([false, true])(
  'uses existing forget-wallet journaling for ciphertext (reset failure: %s)',
  async (fail) => {
    const { wallet } = fixture();
    const vault = structuredClone(store.getState().vault);
    const records: Record<string, any> = {
      'sysweb3-vault': 'synthetic-root-ciphertext',
      'sysweb3-vault-keys': { salt: 'synthetic-salt' },
      state: { vaultGlobal: { activeSlip44: 57 } },
      'state-vault-57': vault,
      [PROFILE_KEY]: { ciphertext: 'opaque encrypted manifest' },
    };
    const original = structuredClone(records);
    global.chrome = {
      ...originalChrome,
      runtime: {},
      storage: {
        local: {
          get: (keys: any, callback: any) => {
            const list =
              keys === null
                ? Object.keys(records)
                : typeof keys === 'string'
                ? [keys]
                : keys;
            callback(
              Object.fromEntries(
                list
                  .filter((key: string) => key in records)
                  .map((key: string) => [key, structuredClone(records[key])])
              )
            );
          },
          set: (values: any, callback: any) => {
            Object.assign(records, structuredClone(values));
            callback();
          },
          remove: (keys: any, callback: any) => {
            (Array.isArray(keys) ? keys : [keys]).forEach(
              (key: string) => delete records[key]
            );
            callback();
          },
        },
      },
    } as any;
    wallet.resetWalletState = async () => {
      wallet.walletSessionGeneration++;
      wallet.walletStateGeneration++;
      await walletPersistenceMutex.runExclusive(async () => {
        delete records[PROFILE_KEY];
        if (fail) throw new Error('synthetic reset failure');
        for (const key of Object.keys(records))
          if (key.startsWith('state') || key.startsWith('sysweb3-vault'))
            delete records[key];
      });
    };
    wallet.lock = () => {
      wallet.walletSessionGeneration++;
    };
    const rehydrate = jest.fn(async () => undefined);
    const context = {
      getState: () => store.getState(),
      persistenceMutex: walletPersistenceMutex,
      readPresence: async () => true,
      storage: chromeStorage,
      rehydrate,
    };
    if (fail) {
      await expect(forgetWalletWithRecovery(wallet, context)).rejects.toThrow(
        'synthetic reset failure'
      );
      expect(records).toEqual(original);
      expect(rehydrate).toHaveBeenCalledTimes(1);
    } else {
      await expect(
        forgetWalletWithRecovery(wallet, context)
      ).resolves.toBeUndefined();
      expect(records).toEqual({});
    }
    expect(wallet.recoveryJournalPending).toBe(false);
  }
);

function importedDepositGuardFixture(xprv: string) {
  const f = depositFixture();
  f.state.vault.accounts.Imported = {
    0: {
      ...f.state.vault.accounts.HDAccount[0],
      xpub: f.state.vault.accounts.HDAccount[0].address,
      xprv,
    },
  };
  f.state.vault.activeAccount = { id: 0, type: KeyringAccountType.Imported };
  return f;
}
it('rejects before creating a note or reading a fee', async () => {
  const f = importedDepositGuardFixture('');
  await expect(
    f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).rejects.toThrow('privacy_deposit_unsupported_account');
  expect(f.vault.prepareDepositNote).not.toHaveBeenCalled();
  for (const operation of Object.values(f.provider))
    expect(operation).not.toHaveBeenCalled();
  expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});
it('preserves the imported private-key deposit path', async () => {
  const f = importedDepositGuardFixture('synthetic-private-key');
  await expect(
    f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' })
  ).resolves.toMatchObject({ account: { type: KeyringAccountType.Imported } });
  expect(f.vault.prepareDepositNote).toHaveBeenCalledTimes(1);
  expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});
it('loses deposit authority when its imported key disappears', async () => {
  const f = importedDepositGuardFixture('synthetic-private-key');
  const review = await f.wallet.preparePrivacyDeposit({ poolId: 'eth-1' });
  f.state.vault.accounts.Imported[0].xprv = '';
  await expect(f.wallet.submitPrivacyDeposit(review.intentId)).rejects.toThrow(
    'privacy_deposit_context_changed'
  );
  expect(f.vault.reserveDepositAttempt).not.toHaveBeenCalled();
  expect(f.wallet.sendAndSaveEthTransaction).not.toHaveBeenCalled();
});
it('retains the shared read-only context for withdrawal callers', () => {
  const f = importedDepositGuardFixture('');
  expect(() => f.wallet.capturePrivacyDepositContext()).not.toThrow();
});

it('completion proof wiring binds selected RPC and routes only the explicit clear request', async () => {
  const { wallet, vault } = depositFixture();
  wallet.networkRequestGeneration = 0;
  const expectedResult = {
    removed: ['00000000-0000-4000-8000-000000000001'],
    unresolved: [],
  };
  (vault as any).clearCompletedNotes = jest.fn(async () => expectedResult);
  await expect(
    wallet.clearPrivateVaultCompletedNotes(expectedResult.removed)
  ).resolves.toEqual(expectedResult);
  expect((vault as any).clearCompletedNotes).toHaveBeenCalledWith(
    expectedResult.removed
  );
  const rpc = jest
    .spyOn(privacyClient, 'readCompletionRpc')
    .mockResolvedValue('0x1');
  let request: any;
  jest
    .spyOn(completion, 'prepareSpentCompletion')
    .mockImplementation(async (value) => {
      request = value;
      value.assertCurrent();
      return { revalidate: async () => value.assertCurrent() };
    });
  const session = wallet.capturePrivateVaultSession();
  await wallet.preparePrivateVaultCompletionProof(
    {
      poolId: 'eth-1',
      commitment: '0x' + '01'.repeat(32),
      nullifierHash: '0x' + '02'.repeat(32),
    },
    {
      phase: 'submitted',
      mode: 'relayed',
      transactionHash: '0x' + '03'.repeat(32),
      endpoint: 'https://relay.example',
      jobId: 'synthetic-job',
    },
    undefined,
    session
  );
  expect(request.withdrawal).toEqual({
    phase: 'submitted',
    mode: 'relayed',
    transactionHash: '0x' + '03'.repeat(32),
  });
  const signal = new AbortController().signal;
  await request.rpc('eth_chainId', [], signal);
  expect(rpc).toHaveBeenCalledWith(
    'https://operator.example',
    'eth_chainId',
    [],
    signal
  );
});

it.each([
  'rpc',
  'network',
  'account',
  'provider',
  'wallet-session',
  'network-aba',
])(
  'completion proof wiring rejects a changed %s before commit',
  async (change) => {
    const { wallet, state } = depositFixture();
    wallet.networkRequestGeneration = 0;
    jest
      .spyOn(completion, 'prepareSpentCompletion')
      .mockImplementation(async (value) => {
        value.assertCurrent();
        return { revalidate: async () => value.assertCurrent() };
      });
    const session = wallet.capturePrivateVaultSession();
    const lease = await wallet.preparePrivateVaultCompletionProof(
      {
        poolId: 'eth-1',
        commitment: '0x' + '01'.repeat(32),
        nullifierHash: '0x' + '02'.repeat(32),
      },
      {
        phase: 'submitted',
        mode: 'relayed',
        transactionHash: '0x' + '03'.repeat(32),
      },
      undefined,
      session
    );
    if (change === 'rpc')
      state.vault.activeNetwork.url = 'https://other.example';
    if (change === 'network') state.vault.activeNetwork.chainId = 57;
    if (change === 'account') state.vault.activeAccount.id = 1;
    if (change === 'provider') wallet.ethereumTransaction.web3Provider = {};
    if (change === 'wallet-session') wallet.walletSessionGeneration++;
    if (change === 'network-aba') wallet.networkRequestGeneration++;
    await expect(lease.revalidate()).rejects.toThrow();
  }
);

it.each([
  'unknown-withdrawal',
  'missing-hash',
  'invalid-direct-nonce',
  'unknown-deposit',
])(
  'completion proof wiring rejects %s before invoking the verifier',
  async (kind) => {
    const { wallet } = depositFixture();
    wallet.networkRequestGeneration = 0;
    const verifier = jest.spyOn(completion, 'prepareSpentCompletion');
    const session = wallet.capturePrivateVaultSession();
    const withdrawal: any = {
      phase: 'submitted',
      mode: 'relayed',
      transactionHash: '0x' + '03'.repeat(32),
    };
    let deposit: any;
    if (kind === 'unknown-withdrawal') withdrawal.phase = 'unknown';
    if (kind === 'missing-hash') delete withdrawal.transactionHash;
    if (kind === 'invalid-direct-nonce')
      Object.assign(withdrawal, {
        mode: 'direct',
        from: '0x' + '11'.repeat(20),
        nonce: 'not-a-nonce',
      });
    if (kind === 'unknown-deposit')
      deposit = {
        phase: 'unknown',
        transactionHash: '0x' + '04'.repeat(32),
        from: '0x' + '11'.repeat(20),
        nonce: '1',
      };
    await expect(
      wallet.preparePrivateVaultCompletionProof(
        {
          poolId: 'eth-1',
          commitment: '0x' + '01'.repeat(32),
          nullifierHash: '0x' + '02'.repeat(32),
        },
        withdrawal,
        deposit,
        session
      )
    ).rejects.toThrow('privacy_spent_proof_unavailable');
    expect(verifier).not.toHaveBeenCalled();
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

it.each(['changed', 'unchanged'] as const)(
  'checks the live chain before deposit fee preparation: %s',
  async (scenario) => {
    const { wallet } = depositFixture();
    const { live, methods, setChain } = cachedChainProvider();
    wallet.ethereumTransaction.web3Provider = live;
    try {
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x1');
      if (scenario === 'changed') setChain('0x89');
      const before = methods.length;
      await expect(live.send('eth_chainId', [])).resolves.toBe('0x1');
      expect(methods).toHaveLength(before); // The installed SDK really cached it.
      const host = wallet.createPrivacyTransactionsHost();
      const session = host.captureContext();
      const quote = host.prepareFees({ value: '0x0' } as any, session);
      if (scenario === 'changed') {
        await expect(quote).rejects.toThrow('privacy_deposit_context_invalid');
        expect(live.estimateGas).not.toHaveBeenCalled();
        expect(live.getFeeData).not.toHaveBeenCalled();
      } else {
        await expect(quote).resolves.toMatchObject({ nonce: '7' });
      }
    } finally {
      live.destroy();
    }
  }
);
