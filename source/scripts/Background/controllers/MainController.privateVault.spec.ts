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
    reserveDepositAttempt: jest.fn(async () => undefined),
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

it('does not transfer an admitted request across a delayed chunk load', async () => {
  const { wallet } = fixture();
  const release = deferred();
  const getNotes = jest.fn(async () => ({ notes: [] }));
  wallet.privateVaultController = release.promise.then(() => ({ getNotes }));
  const result = wallet.getPrivateVaultNotes();
  const failure = expect(result).rejects.toThrow(
    'privacy_vault_session_changed'
  );
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
      return { result: method === 'eth_chainId' ? '0x1' : nonce };
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
    0: { ...f.state.vault.accounts.HDAccount[0], isLedgerWallet: false },
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
