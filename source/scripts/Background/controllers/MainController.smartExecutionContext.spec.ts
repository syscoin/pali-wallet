jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyAccountChange: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('./storageManager', () => ({
  StorageManager: {
    getInstance: () => ({ ensureInitialized: async () => undefined }),
  },
}));
jest.mock('utils/evmCallBlacklist', () => ({
  getBlacklistTargetsForEvmCallWithContractType: jest
    .fn()
    .mockResolvedValue([]),
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn().mockResolvedValue(undefined),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
}));

import { getController } from '..';
import store from 'state/store';
import { setActiveAccount } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const OWNER_ADDRESS = `0x${'11'.repeat(20)}`;
const SMART_ACCOUNT_ADDRESS = `0x${'22'.repeat(20)}`;
const ACTION_HASH = `0x${'33'.repeat(32)}`;
const EXECUTION_CONTEXT_ID = 'approved-smart-account-operation';

describe('smart-account signing and outer broadcast context', () => {
  let wallet: any;
  let currentState: any;
  let keyring: any;
  let sign: jest.Mock;
  let send: jest.Mock;
  const owner = { id: 0, type: KeyringAccountType.HDAccount };
  const smartAccount = { id: 1, type: KeyringAccountType.SmartAccount };
  const response = {
    hash: `0x${'44'.repeat(32)}`,
    nonce: 7,
    chainId: 1,
  };
  const metadata = {
    smartAccountExecution: true,
    smartAccountExecutionFrom: SMART_ACCOUNT_ADDRESS,
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation();
    (getBlacklistTargetsForEvmCallWithContractType as jest.Mock)
      .mockReset()
      .mockResolvedValue([]);
    currentState = {
      vault: {
        isBitcoinBased: false,
        activeNetwork: {
          chainId: 1,
          kind: INetworkType.Ethereum,
          url: 'rpc-a',
        },
        activeAccount: smartAccount,
        accounts: {
          HDAccount: { 0: { ...owner, address: OWNER_ADDRESS } },
          SmartAccount: {
            1: { ...smartAccount, address: SMART_ACCOUNT_ADDRESS },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => currentState);
    sign = jest.fn().mockResolvedValue('owner-signature');
    send = jest.fn().mockResolvedValue(response);
    (getController as jest.Mock).mockReturnValue({
      wallet: {
        ethereumTransaction: {
          ethSign: sign,
          web3Provider: {},
          sendFormattedTransaction: send,
        },
      },
    });
    keyring = { setVaultStateGetter: jest.fn() };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.sendAndSaveTransaction = jest.fn().mockResolvedValue(undefined);
    wallet.smartAccount = {
      assertSmartAccountExecutionContext: jest.fn((id, digest) => {
        if (id !== EXECUTION_CONTEXT_ID || digest !== ACTION_HASH)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it('checks the bound action digest before signing and before exposing the result', async () => {
    await expect(
      wallet.signSmartAccountActionDigestInternal(
        [OWNER_ADDRESS, ACTION_HASH],
        owner,
        EXECUTION_CONTEXT_ID
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledWith([OWNER_ADDRESS, ACTION_HASH]);
    const assertContext =
      wallet.smartAccount.assertSmartAccountExecutionContext;
    expect(assertContext.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(assertContext.mock.calls[0].slice(0, 2)).toEqual([
      EXECUTION_CONTEXT_ID,
      ACTION_HASH,
    ]);
    expect(assertContext.mock.calls.at(-1).slice(0, 2)).toEqual([
      EXECUTION_CONTEXT_ID,
      ACTION_HASH,
    ]);
    expect(keyring.setVaultStateGetter).toHaveBeenCalledTimes(2);
    const restoredGetter = keyring.setVaultStateGetter.mock.calls[1][0];
    expect(restoredGetter()).toBe(currentState.vault);
  });

  it.each([
    ['a stale operation token', 'stale-token', ACTION_HASH],
    ['an unrelated digest', EXECUTION_CONTEXT_ID, `0x${'55'.repeat(32)}`],
  ])('rejects %s before ethSign', async (_reason, contextId, digest) => {
    await expect(
      wallet.signSmartAccountActionDigestInternal(
        [OWNER_ADDRESS, digest],
        owner,
        contextId
      )
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).not.toHaveBeenCalled();
  });

  it('suppresses a completed signature when the wallet context changed while signing', async () => {
    let finishSigning!: (value: string) => void;
    sign.mockImplementation(
      () => new Promise((resolve) => (finishSigning = resolve))
    );
    const signing = wallet.signSmartAccountActionDigestInternal(
      [OWNER_ADDRESS, ACTION_HASH],
      owner,
      EXECUTION_CONTEXT_ID
    );
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    finishSigning('owner-signature');
    await expect(signing).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(keyring.setVaultStateGetter).toHaveBeenCalledTimes(2);
  });

  it('rejects a context change while selecting the owner before invoking ethSign', async () => {
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        if (currentState.vault.activeNetwork.url !== 'rpc-a')
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    keyring.setVaultStateGetter.mockImplementationOnce(() => {
      currentState.vault.activeNetwork.url = 'rpc-b';
    });
    await expect(
      wallet.signSmartAccountActionDigestInternal(
        [OWNER_ADDRESS, ACTION_HASH],
        owner,
        EXECUTION_CONTEXT_ID
      )
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).not.toHaveBeenCalled();
  });

  it('preserves the locally derived guardian recovery signing path without an execution token', async () => {
    await expect(
      wallet.signSmartAccountActionDigestInternal(
        [OWNER_ADDRESS, ACTION_HASH],
        owner
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(
      wallet.smartAccount.assertSmartAccountExecutionContext
    ).not.toHaveBeenCalled();
  });

  const contextGuard = () => {
    if (
      currentState.vault.activeNetwork.url !== 'rpc-a' ||
      currentState.vault.activeAccount.id !== smartAccount.id ||
      wallet.walletSessionGeneration !== 5
    )
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
  };

  it.each(['rpc', 'account', 'session'])(
    'rejects a %s change during deferred outer transaction preflight before invoking the sender',
    async (change) => {
      let finishPreflight!: (value: any[]) => void;
      (
        getBlacklistTargetsForEvmCallWithContractType as jest.Mock
      ).mockImplementationOnce(
        () => new Promise((resolve) => (finishPreflight = resolve))
      );
      const sending = wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        { assertCurrentContext: contextGuard }
      );
      if (change === 'rpc') currentState.vault.activeNetwork.url = 'rpc-b';
      if (change === 'account')
        currentState.vault.activeAccount = { ...smartAccount, id: 2 };
      if (change === 'session') wallet.walletSessionGeneration += 1;
      finishPreflight([]);
      await expect(sending).rejects.toMatchObject({
        message: EVM_TRANSACTION_CONTEXT_CHANGED,
        transactionNotBroadcast: true,
      });
      expect(send).not.toHaveBeenCalled();
      expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
    }
  );

  it('checks the smart context again after preparing the separate outer payer', async () => {
    keyring.setVaultStateGetter.mockImplementationOnce(() => {
      currentState.vault.activeNetwork.url = 'rpc-b';
    });
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        { assertCurrentContext: contextGuard }
      )
    ).rejects.toMatchObject({
      message: EVM_TRANSACTION_CONTEXT_CHANGED,
      transactionNotBroadcast: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('allows an unchanged smart-account approval to use its separate local outer payer', async () => {
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        { assertCurrentContext: contextGuard }
      )
    ).resolves.toMatchObject(response);
    expect(send).toHaveBeenCalledTimes(1);
    expect(wallet.sendAndSaveTransaction).toHaveBeenCalledTimes(1);
    expect(currentState.vault.activeAccount).toEqual(smartAccount);
  });

  describe('public account-switch session invalidation', () => {
    beforeEach(() => {
      currentState.vault.accounts.SmartAccount[1].smartAccount = { chainId: 1 };
      currentState.vault.accounts.SmartAccount[2] = {
        id: 2,
        type: KeyringAccountType.SmartAccount,
        address: `0x${'66'.repeat(20)}`,
        smartAccount: { chainId: 1 },
      };
      jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
        if (action.type === setActiveAccount.type)
          currentState.vault.activeAccount = action.payload;
        return action;
      });
      wallet.stopAllRapidPolling = jest.fn();
      wallet.cancellablePromises = {};
      wallet.assetUpdateRequestId = 0;
      wallet.cancelActiveBalanceUpdate = jest.fn();
      wallet.resetAutoLockTimer = jest.fn();
      wallet.performPostAccountSwitchOperations = jest
        .fn()
        .mockResolvedValue(undefined);
    });

    it('preserves the session when the public setter selects the same account', async () => {
      await wallet.setAccount(1, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(5);
      expect(currentState.vault.activeAccount).toEqual(smartAccount);
    });

    it('cannot revive the original approval session by switching A to B and back to A', async () => {
      const expectedContext = {
        account: { ...smartAccount, address: SMART_ACCOUNT_ADDRESS },
        chainId: 1,
        rpcUrl: 'rpc-a',
        sessionGeneration: wallet.getWalletSessionGeneration(),
        slip44: 60,
      };
      await wallet.setAccount(2, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(6);
      await wallet.setAccount(1, KeyringAccountType.SmartAccount);
      expect(wallet.getWalletSessionGeneration()).toBe(7);
      expect(currentState.vault.activeAccount).toEqual(smartAccount);

      const getEthereumTransaction = jest.fn();
      const smartController = new SmartAccountController({
        getEthereumTransaction,
        getWalletSessionGeneration: () => wallet.getWalletSessionGeneration(),
      } as any);
      await expect(
        smartController.prepareSmartAccountExecutions(
          [{ data: '0x', target: OWNER_ADDRESS, value: '0x0' }],
          1,
          { expectedContext }
        )
      ).rejects.toMatchObject({
        message: EVM_TRANSACTION_CONTEXT_CHANGED,
        transactionNotBroadcast: true,
      });
      expect(getEthereumTransaction).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });
});
