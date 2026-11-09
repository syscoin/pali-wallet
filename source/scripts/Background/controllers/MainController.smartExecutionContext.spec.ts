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
import { buildSmartAccountUserOperation } from '../../../utils/smartAccount/account';
import { createSmartAccountRawSigningIntent } from '../../../utils/smartAccount/ownerSigningIntent';
import { buildSmartAccountUserOpSigningIntent } from '../../../utils/smartAccount/userOperationHash';
import store from 'state/store';
import { setActiveAccount } from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getBlacklistTargetsForEvmCallWithContractType } from 'utils/evmCallBlacklist';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const OWNER_ADDRESS = `0x${'11'.repeat(20)}`;
const SMART_ACCOUNT_ADDRESS = `0x${'22'.repeat(20)}`;
const SIGNING_INTENT = buildSmartAccountUserOpSigningIntent(
  buildSmartAccountUserOperation({
    sender: SMART_ACCOUNT_ADDRESS,
    nonce: '1',
    callData: '0x',
    initCode: '0x',
    accountGasLimits: '0x' + '00'.repeat(32),
    gasFees: '0x' + '00'.repeat(32),
    preVerificationGas: '1',
  }),
  1
);
const ACTION_HASH = SIGNING_INTENT.actionHash;
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

  const documentAuthority = () => ({
    kind: 'document' as const,
    signal: new AbortController().signal,
    assertCurrent() {
      if (wallet.walletSessionGeneration !== 5)
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    },
  });

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
    keyring = {
      isUnlocked: () => true,
      setVaultStateGetter: jest.fn(),
      ethereumTransaction: {
        ethSign: sign,
        web3Provider: {},
        sendFormattedTransaction: send,
      },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.sendAndSaveTransaction = jest.fn().mockResolvedValue(undefined);
    wallet.smartAccount = {
      captureOwnerSigningIntent: jest.fn((id) => {
        if (id !== EXECUTION_CONTEXT_ID)
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
        return { intent: SIGNING_INTENT, expiresAt: Date.now() + 300000 };
      }),
      assertSmartAccountPreparedNonce: jest.fn(async () => undefined),
      assertSmartAccountExecutionContext: jest.fn((id, digest) => {
        if (
          id !== EXECUTION_CONTEXT_ID ||
          (digest !== undefined && digest !== ACTION_HASH)
        )
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects a stale prepared nonce before starting the SLH signing path', async () => {
    wallet.configureSLHDSASessionStateCrypto = jest.fn();
    wallet.smartAccount.assertSmartAccountPreparedNonce.mockRejectedValueOnce(
      new Error('nonce changed')
    );
    await expect(
      wallet.signSLHDSAActionHash({
        actionHash: ACTION_HASH,
        executionContextId: EXECUTION_CONTEXT_ID,
      })
    ).rejects.toThrow('nonce changed');
    expect(wallet.configureSLHDSASessionStateCrypto).not.toHaveBeenCalled();
  });

  it('checks the bound action digest before signing and before exposing the result', async () => {
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledWith([OWNER_ADDRESS, ACTION_HASH], {
      selectedAccount: {
        ...smartAccount,
        expectedAddress: SMART_ACCOUNT_ADDRESS,
      },
      targetAccount: { ...owner, expectedAddress: OWNER_ADDRESS },
      assertCurrent: expect.any(Function),
      signal: expect.any(AbortSignal),
    });
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
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it.each(['stale-token', undefined, [OWNER_ADDRESS, ACTION_HASH]])(
    'rejects invalid prepared context %j before SDK signing',
    async (contextId) => {
      await expect(
        wallet.signSmartAccountPreparedOwner(
          contextId,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it('rejects old arity or a renderer digest in place of actual document authority', async () => {
    for (const authority of [undefined, null, `0x${'55'.repeat(32)}`]) {
      await expect(
        wallet.signSmartAccountPreparedOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          authority
        )
      ).rejects.toThrow('Owned document authority');
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(['address', 'xpub'])(
    'pins owner %s through the prepared nonce wait before SDK dispatch',
    async (field) => {
      let finish!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      wallet.smartAccount.assertSmartAccountPreparedNonce.mockImplementationOnce(
        () => {
          entered();
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
      );
      const pending = wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      );
      const rejected = expect(pending).rejects.toThrow(
        EVM_TRANSACTION_CONTEXT_CHANGED
      );
      await started;
      currentState.vault.accounts.HDAccount[0] = {
        ...currentState.vault.accounts.HDAccount[0],
        [field]: field === 'address' ? '0x' + '99'.repeat(20) : 'new-xpub',
      };
      finish();
      await rejected;
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it('keeps metadata-only owner replacement healthy during nonce validation', async () => {
    wallet.smartAccount.assertSmartAccountPreparedNonce.mockImplementationOnce(
      async () => {
        currentState.vault.accounts.HDAccount[0] = {
          ...currentState.vault.accounts.HDAccount[0],
          label: 'New label',
          balances: { ethereum: '9' },
        };
      }
    );
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('suppresses a completed signature when the wallet context changed while signing', async () => {
    let finishSigning!: (value: string) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    sign.mockImplementation(() => {
      entered();
      return new Promise((resolve) => (finishSigning = resolve));
    });
    const signing = wallet.signSmartAccountPreparedOwner(
      EXECUTION_CONTEXT_ID,
      owner,
      documentAuthority()
    );
    await started;
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    finishSigning('owner-signature');
    await expect(signing).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it('rejects a context change at the explicitly bound owner SDK boundary', async () => {
    wallet.smartAccount.assertSmartAccountExecutionContext.mockImplementation(
      () => {
        if (currentState.vault.activeNetwork.url !== 'rpc-a')
          throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
      }
    );
    sign.mockImplementationOnce(async (_params, options) => {
      currentState.vault.activeNetwork.url = 'rpc-b';
      options.assertCurrent();
      return 'unreachable';
    });
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it.each(['network metadata', 'SDK owner', 'wallet session'])(
    'rejects %s changes at the exact SDK return boundary',
    async (axis) => {
      sign.mockImplementationOnce(async () => {
        if (axis === 'network metadata')
          currentState.vault.activeNetwork = {
            ...currentState.vault.activeNetwork,
            currency: 'CHANGED',
          };
        else if (axis === 'SDK owner')
          wallet.getActiveKeyring.mockReturnValue({ ...keyring });
        else wallet.walletSessionGeneration++;
        return 'late-signature';
      });
      await expect(
        wallet.signSmartAccountPreparedOwner(
          EXECUTION_CONTEXT_ID,
          owner,
          documentAuthority()
        )
      ).rejects.toThrow();
      expect(sign).toHaveBeenCalledTimes(1);
    }
  );

  it('checks the personal-sign approval again at the actual smart owner SDK invocation', async () => {
    let approvalCurrent = true;
    const assertApproval = () => {
      if (!approvalCurrent) throw new Error('Approval retired');
    };
    sign.mockImplementationOnce(async (_params, options) => {
      approvalCurrent = false;
      options.assertCurrent();
      return 'unreachable';
    });
    await expect(
      wallet.signSmartAccountMessageOwnerInternal(SIGNING_INTENT, owner, {
        assertCurrent: assertApproval,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Approval retired');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved Promise', () => Promise.resolve()],
    ['rejected Promise', () => Promise.reject(new Error('Retired approval'))],
    ['nonvoid result', () => true],
  ])(
    'rejects a %s approval guard before invoking the SDK',
    async (_name, guard) => {
      await expect(
        wallet.signSmartAccountOperationOwnerInternal(
          EXECUTION_CONTEXT_ID,
          owner,
          guard
        )
      ).rejects.toThrow('EVM fee approval guard must be synchronous');
      expect(sign).not.toHaveBeenCalled();
      expect(keyring.setVaultStateGetter).not.toHaveBeenCalled();
    }
  );

  it('preserves software recovery only through its private prepared context and rejects hardware before SDK', async () => {
    wallet.smartAccount.captureOwnerSigningIntent.mockReturnValue({
      intent: createSmartAccountRawSigningIntent(
        'recovery',
        ACTION_HASH,
        'recovery-digest'
      ),
      expiresAt: Date.now() + 300000,
    });
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        owner,
        documentAuthority()
      )
    ).resolves.toBe('owner-signature');
    sign.mockClear();
    await expect(
      wallet.signSmartAccountPreparedOwner(
        EXECUTION_CONTEXT_ID,
        {
          ...owner,
          type: KeyringAccountType.Ledger,
        },
        documentAuthority()
      )
    ).rejects.toThrow('software owner');
    expect(sign).not.toHaveBeenCalled();
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
        {
          assertCurrentContext: contextGuard,
          assertPendingState: async () => undefined,
        }
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
    send.mockImplementationOnce(async (_transaction, _legacy, options) => {
      currentState.vault.activeNetwork.url = 'rpc-b';
      try {
        options.assertCurrent();
      } catch (error) {
        throw Object.assign(error, { transactionNotBroadcast: true });
      }
      return response;
    });
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        {
          assertCurrentContext: contextGuard,
          assertPendingState: async () => undefined,
        }
      )
    ).rejects.toMatchObject({
      message: EVM_TRANSACTION_CONTEXT_CHANGED,
      transactionNotBroadcast: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(wallet.sendAndSaveTransaction).not.toHaveBeenCalled();
  });

  it('allows an unchanged smart-account approval to use its separate local outer payer', async () => {
    await expect(
      wallet.sendAndSaveEthTransaction(
        { chainId: 1, value: '0x0' },
        false,
        owner,
        metadata,
        {
          assertCurrentContext: contextGuard,
          assertPendingState: async () => undefined,
        }
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
        captureSmartAccountPendingRecords: async () => ({
          profileId: '0x' + '11'.repeat(32),
          read: async () => [],
        }),
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
