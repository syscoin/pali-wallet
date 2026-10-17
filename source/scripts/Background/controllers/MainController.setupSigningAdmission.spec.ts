jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: { toPali: jest.fn((psbt) => psbt) },
}));
jest.mock('./walletRecovery', () => ({
  runWalletSetup: jest.fn(),
}));
jest.mock('utils/slhDsa', () => ({
  cancelSLHDSAWorkerInOffscreen: jest.fn(async () => undefined),
  clearRuntimeSLHDSAStates: jest.fn(),
  clearSLHDSAPublicPrecomputeCache: jest.fn(async () => undefined),
  clearSLHDSAXmssTreeCache: jest.fn(async () => undefined),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(async () => undefined),
  clearTransactionNavigationState: jest.fn(async () => undefined),
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest.fn(async () => []),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));

import { getController } from '..';
import { AsyncMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';
import { runWalletSetup } from './walletRecovery';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let mockState: any;

describe('wallet setup signing capability admission', () => {
  let wallet: any;
  let keyring: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        isBitcoinBased: true,
        activeAccount: { id: 0, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            0: { id: 0, address: 'public-address', xpub: 'public-xpub' },
          },
        },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 57,
          url: 'https://example.invalid',
        },
      },
      vaultGlobal: { activeSlip44: 57 },
    };
    keyring = {
      isUnlocked: jest.fn(() => true),
      getSeed: jest.fn(async () => 'synthetic seed fixture'),
      getPrivateKeyByAccountId: jest.fn(
        async () => 'synthetic private-key fixture'
      ),
      syscoinTransaction: {
        signPSBT: jest.fn(async () => 'signed fixture'),
        sendTransaction: jest.fn(),
      },
      ethereumTransaction: {
        web3Provider: { getBlockNumber: jest.fn() },
        ethSign: jest.fn(),
      },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.isCreatingWallet = false;
    wallet.isResettingWallet = false;
    wallet.recoveryJournalPending = false;
    wallet.authenticationMutex = new AsyncMutex();
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.walletRecoveryContext = jest.fn(() => ({}));
    wallet.verifySyscoinPsbt = jest.fn(async () => ({
      psbt: 'verified fixture',
    }));
    wallet.getProtectedSentryOutpoints = jest.fn().mockResolvedValue([]);
    wallet.checkRateLimit = jest.fn(async () => 0);
    wallet.resetRateLimit = jest.fn(async () => undefined);
  });

  it('rejects an old approval while initialization exposes an unlocked keyring before commit', async () => {
    const initialized = deferred();
    const commit = deferred();
    jest.mocked(runWalletSetup).mockImplementation(async () => {
      wallet.walletSessionGeneration += 1;
      wallet.walletStateGeneration += 1;
      initialized.resolve();
      await commit.promise;
    });
    const recovery = wallet.recoverWalletFromSeed(
      'password fixture',
      'seed fixture',
      'ticket fixture'
    );
    await initialized.promise;
    expect(wallet.isUnlocked()).toBe(true);
    expect(wallet.getWalletSetupStatus()).toBe('busy');
    try {
      await expect(
        wallet.signSyscoinPsbt({ psbt: 'stale approval fixture' })
      ).rejects.toThrow('Wallet setup');
      expect(wallet.verifySyscoinPsbt).not.toHaveBeenCalled();
      expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
    } finally {
      commit.resolve();
      await recovery;
    }
    await expect(
      wallet.signSyscoinPsbt({ psbt: 'fresh approval fixture' })
    ).resolves.toBe('signed fixture');
    expect(keyring.syscoinTransaction.signPSBT).toHaveBeenCalledTimes(1);
  });

  it.each(['isCreatingWallet', 'isResettingWallet', 'recoveryJournalPending'])(
    'blocks SDK signing delegates and secret exports while %s is set',
    async (flag) => {
      wallet[flag] = true;
      expect(() => wallet.ethereumTransaction).toThrow('Wallet setup');
      expect(() => wallet.syscoinTransaction).toThrow('Wallet setup');
      await expect(wallet.getSeed('password fixture')).rejects.toThrow(
        'Wallet setup'
      );
      await expect(
        wallet.getPrivateKeyByAccountId(0, 'HDAccount', 'password fixture')
      ).rejects.toThrow('Wallet setup');
      expect(keyring.getSeed).not.toHaveBeenCalled();
      expect(keyring.getPrivateKeyByAccountId).not.toHaveBeenCalled();
      expect(wallet.isUnlocked()).toBe(true);
    }
  );

  it('keeps ordinary locked public SDK reads and committed signing available', async () => {
    keyring.isUnlocked.mockReturnValue(false);
    expect(wallet.ethereumTransaction.web3Provider).toBe(
      keyring.ethereumTransaction.web3Provider
    );
    expect(wallet.syscoinTransaction).toBe(keyring.syscoinTransaction);
    keyring.isUnlocked.mockReturnValue(true);
    await expect(wallet.getSeed('password fixture')).resolves.toBe(
      'synthetic seed fixture'
    );
  });

  it('retains an acknowledged EVM hash when setup starts during submission and skips stale local persistence', async () => {
    const acknowledged = { hash: `0x${'1'.repeat(64)}` };
    (getController as jest.Mock).mockReturnValue({ wallet });
    keyring.ethereumTransaction.sendFormattedTransaction = jest.fn(async () => {
      wallet.isCreatingWallet = true;
      return acknowledged;
    });
    wallet.sendAndSaveTransaction = jest.fn();
    await expect(wallet.sendAndSaveEthTransaction({})).resolves.toEqual(
      acknowledged
    );
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('rejects a setup transition after PSBT verification before calling any signer', async () => {
    let verified!: (value: any) => void;
    wallet.verifySyscoinPsbt.mockImplementation(
      () =>
        new Promise((resolve) => {
          verified = resolve;
        })
    );
    const signing = wallet.signSyscoinPsbt({ psbt: 'approval fixture' });
    const rejection = expect(signing).rejects.toThrow(
      'PALI_PSBT_SIGNING_CONTEXT_CHANGED'
    );
    wallet.recoveryJournalPending = true;
    verified({ psbt: 'verified fixture' });
    await rejection;
    expect(keyring.syscoinTransaction.signPSBT).not.toHaveBeenCalled();
  });

  it.each([
    ['speedUpEvmTransaction', ['hash', false, 1]],
    ['cancelEvmTransaction', ['hash']],
    ['sendAndSaveEthTransaction', [{}]],
    ['sendAndSaveTokenTransaction', ['ERC20', {}]],
    ['signSendAndSaveTransaction', [{ psbt: 'fixture' }]],
    [
      'signSmartAccountActionDigestInternal',
      [[], { id: 0, type: 'HDAccount' }],
    ],
    ['startSLHDSASmartAccountValidatorSetup', [{ accountId: 0 }]],
    ['provisionSLHDSASmartAccountValidator', [{ accountId: 0 }]],
    ['deriveSLHDSASetupSecretForAccount', [{ accountIndex: 0 }]],
    ['signSLHDSAActionHash', [{}]],
    ['signSLHDSARecoveryTargetActionHash', [{}]],
    ['registerSmartAccountOnChain', [{}]],
    ['deploySmartAccountInfrastructure', []],
    ['submitSmartAccountExecution', [{}]],
    ['submitSmartAccountGuardianPolicyTransaction', [{}]],
    ['submitSmartAccountGuardianStartRecovery', [{}]],
    ['submitPreparedSmartAccountGuardianStartRecovery', [{}]],
    ['finalizeSmartAccountGuardianRecovery', [{}]],
  ])(
    'rejects %s before privileged delegates while a failed recovery journal remains',
    async (method, args) => {
      wallet.recoveryJournalPending = true;
      const errors = jest.spyOn(console, 'error').mockImplementation();
      try {
        await expect(
          Promise.resolve().then(() =>
            wallet[method as string](...(args as any[]))
          )
        ).rejects.toThrow('Wallet setup');
        expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    }
  );

  it('blocks later use of captured SLH session crypto and network mutation before setup state changes', async () => {
    const crypto = wallet.getSLHDSASessionStateCrypto();
    wallet.networkRequestGeneration = 7;
    wallet.recoveryJournalPending = true;
    await expect(crypto.decrypt('encrypted fixture')).rejects.toThrow(
      'Wallet setup'
    );
    await expect(crypto.encrypt('plaintext fixture')).rejects.toThrow(
      'Wallet setup'
    );
    await expect(wallet.setActiveNetwork({ chainId: 1 })).rejects.toThrow(
      'Wallet setup'
    );
    expect(wallet.networkRequestGeneration).toBe(7);
    expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
  });
  it('waits for every dispatched reset deletion before permitting rollback writes', async () => {
    const original = { saved: 'original public wallet state' };
    const records: any = { state: original, 'state-vault-60': { saved: true } };
    const batchStarted = deferred();
    let finishDeletion!: () => void;
    const get = jest
      .spyOn(chrome.storage.local, 'get')
      .mockImplementation((_keys: any, callback: any) =>
        callback({ ...records })
      );
    const remove = jest
      .spyOn(chrome.storage.local, 'remove')
      .mockImplementation((keys: any, callback: any) => {
        const key = keys[0];
        if (key === 'state')
          finishDeletion = () => {
            delete records.state;
            callback();
          };
        else if (key === 'state-vault-60') {
          (chrome.runtime as any).lastError = {
            message: 'native deletion failed',
          };
          callback();
          delete (chrome.runtime as any).lastError;
          batchStarted.resolve();
        } else {
          delete records[key];
          callback();
        }
      });
    const write = jest
      .spyOn(chrome.storage.local, 'set')
      .mockImplementation((items: any, callback: any) => {
        Object.assign(records, items);
        callback();
      });
    const log = jest.spyOn(console, 'error').mockImplementation();
    Object.assign(wallet, {
      keyrings: new Map(),
      cancellablePromises: {},
      assetUpdateRequestId: 0,
      clearAllTimers: jest.fn(),
      stopAllRapidPolling: jest.fn(),
      disposeAllKeyrings: jest.fn(),
      cleanupPersistentProviders: jest.fn(),
      cancelActiveBalanceUpdate: jest.fn(),
      stopAutoLockTimer: jest.fn(async () => undefined),
    });
    let returned = false;
    const reset = wallet.resetWalletState();
    const rollback = reset.then(async () => {
      returned = true;
      await chromeStorage.setItem('state', original);
    });
    try {
      await batchStarted.promise;
      for (let step = 0; step < 10; step += 1) await Promise.resolve();
      expect(returned).toBe(false);
      expect(wallet.isResettingWallet).toBe(true);
      finishDeletion();
      await rollback;
      expect(records.state).toEqual(original);
      expect(wallet.isResettingWallet).toBe(false);
      expect(log).toHaveBeenCalledWith(
        '[MainController] Error clearing slip44 vault states during reset:',
        expect.objectContaining({ message: 'native deletion failed' })
      );
    } finally {
      finishDeletion?.();
      await rollback;
      get.mockRestore();
      remove.mockRestore();
      write.mockRestore();
      log.mockRestore();
    }
  });
});
