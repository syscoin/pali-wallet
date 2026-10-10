import { BigNumber } from '@sidhujag/sysweb3-keyring/cjs/ethers-v6';
import { KeyringManager } from '@sidhujag/sysweb3-keyring/cjs/keyring-manager';
import {
  privateKeyToAccount,
  sendLocalEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';
import { handleUpdateTransaction, UpdateTxAction } from 'utils/transactions';

import MainController from './MainController';

jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/keyring-manager'
  ).KeyringManager,
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
let mockState: any;
const mockPersist = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (action: any) => {
      mockState = {
        ...mockState,
        vault: vaultReducer(mockState.vault, action),
      };
    },
  },
  persistCommittedWalletState: (...args: any[]) => mockPersist(...args),
}));
jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer',
  () => ({
    ...jest.requireActual(
      '@sidhujag/sysweb3-keyring/cjs/transactions/evm-local-signer'
    ),
    privateKeyToAccount: jest.fn(),
    sendLocalEvmTransaction: jest.fn(),
  })
);
jest.mock('crypto-js', () => ({
  ...jest.requireActual('crypto-js'),
  AES: { ...jest.requireActual('crypto-js').AES, decrypt: jest.fn() },
}));
jest.mock('syscoinjs-lib', () => ({
  utils: { bitcoinjs: {} },
  networks: { bitcoin: {}, syscoin: {} },
}));
jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/hardware-wallet-manager-singleton',
  () => ({
    HardwareWalletManagerSingleton: { getInstance: () => ({}) },
  })
);
jest.mock('@sidhujag/sysweb3-keyring/cjs/ledger', () => ({
  LedgerKeyring: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring/cjs/trezor', () => ({
  TrezorKeyring: jest.fn(),
}));

const aes = jest.requireMock('crypto-js').AES;
const PAYER = `0x${'11'.repeat(20)}`;
const SMART = `0x${'22'.repeat(20)}`;
const TARGET = `0x${'33'.repeat(20)}`;
const ORIGINAL = `0x${'44'.repeat(32)}`;
const REPLACEMENT = `0x${'55'.repeat(32)}`;
const CHAIN = 5700;
const owner = { type: KeyringAccountType.SmartAccount, id: 7 };
const rawOriginal = (fields: any = {}) => ({
  hash: ORIGINAL,
  from: PAYER,
  to: TARGET,
  nonce: 8,
  chainId: CHAIN,
  blockNumber: null,
  value: BigNumber.from(7),
  data: '0x1234',
  type: 2,
  gasLimit: BigNumber.from(21000),
  gasPrice: BigNumber.from(100),
  maxFeePerGas: BigNumber.from(100),
  maxPriorityFeePerGas: BigNumber.from(10),
  ...fields,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => (resolve = finish));
  return { promise, resolve };
};

describe('SmartAccount speedup utility to actual keyring handoff', () => {
  let wallet: any;
  let keyring: any;
  let provider: any;
  let currentProvider: any;
  let replaceGetter: jest.SpyInstance;
  let alert: { error: jest.Mock; success: jest.Mock; warning: jest.Mock };
  const response = { ...rawOriginal(), hash: REPLACEMENT };
  const transactions = () =>
    mockState.vault.accountTransactions.SmartAccount[7].ethereum[CHAIN];
  const run = (legacy = false, signer = PAYER) =>
    handleUpdateTransaction({
      t: (key, options) => (options ? `${key}: ${options.hash}` : key),
      updateData: {
        alert,
        chainId: CHAIN,
        isLegacy: legacy,
        txHash: ORIGINAL,
        updateType: UpdateTxAction.SpeedUp,
        signerAddress: signer,
      },
    });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const initial: any = vaultReducer(undefined, { type: 'test/init' });
    mockState = {
      vault: {
        ...initial,
        isBitcoinBased: false,
        activeAccount: owner,
        activeNetwork: {
          chainId: CHAIN,
          kind: INetworkType.Ethereum,
          slip44: 60,
          currency: 'tsys',
          url: 'rpc-a',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            3: { id: 3, address: PAYER, xprv: 'synthetic-payer-ciphertext' },
          },
          SmartAccount: {
            7: { id: 7, address: SMART, smartAccount: { chainId: CHAIN } },
          },
        },
        accountTransactions: {
          ...initial.accountTransactions,
          SmartAccount: {
            7: {
              syscoin: {},
              ethereum: {
                [CHAIN]: [
                  {
                    ...rawOriginal(),
                    value: '7',
                    input: '0x1234',
                    smartAccountExecutionFrom: SMART,
                  },
                ],
              },
            },
          },
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    provider = {
      getTransaction: jest.fn().mockResolvedValue(rawOriginal()),
      getBalance: jest.fn().mockResolvedValue(BigNumber.from('1000000000')),
      sendTransaction: jest.fn().mockResolvedValue(response),
    };
    currentProvider = provider;
    keyring = new KeyringManager();
    keyring.setVaultStateGetter(() => mockState.vault);
    replaceGetter = jest.spyOn(keyring, 'setVaultStateGetter');
    keyring.sessionPassword = {};
    keyring.withSecureData = (read: (password: string) => unknown) =>
      read('synthetic-session-password');
    aes.decrypt.mockReturnValue({ toString: () => 'mocked-private-key' });
    jest.mocked(privateKeyToAccount).mockReturnValue({ address: PAYER } as any);
    Object.defineProperty(keyring.ethereumTransaction, 'web3Provider', {
      configurable: true,
      get: () => currentProvider,
    });
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 5;
    wallet.isResettingWallet = false;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.startRapidTransactionPolling = jest.fn();
    mockPersist.mockImplementation(async (_include, _skip, current) => {
      if (!current()) throw new Error('PALI_TRANSACTION_CONTEXT_CHANGED');
    });
    jest
      .mocked(controllerEmitter)
      .mockImplementation(async (route: string[], args: any[]) => {
        let target: any = { wallet };
        for (const name of route.slice(0, -1)) target = target[name];
        return target[route[route.length - 1]](...args);
      });
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementation(
        async (capturedProvider, _key, _tx, beforeBroadcast, beforeSign) => {
          await Promise.resolve();
          beforeSign?.();
          beforeBroadcast?.();
          return capturedProvider.sendTransaction('mocked-signed-transaction');
        }
      );
    alert = { error: jest.fn(), warning: jest.fn(), success: jest.fn() };
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'uses the actual recorded payer credential and preserves payload/metadata (legacy=%s)',
    async (legacy) => {
      await run(legacy);
      expect(alert.success).toHaveBeenCalledWith(
        'transactions.transactionAcceleratedSuccessfully'
      );
      expect(alert.error).not.toHaveBeenCalled();
      expect(aes.decrypt).toHaveBeenCalledWith(
        'synthetic-payer-ciphertext',
        'synthetic-session-password'
      );
      expect(replaceGetter).not.toHaveBeenCalled();
      expect(mockState.vault.activeAccount).toEqual(owner);
      const replacement = jest.mocked(sendLocalEvmTransaction).mock.calls[0][2];
      expect(replacement).toMatchObject({
        from: PAYER,
        to: TARGET,
        nonce: 8,
        data: '0x1234',
        chainId: CHAIN,
      });
      expect(replacement.value.toString()).toBe('7');
      expect(
        (legacy ? replacement.gasPrice : replacement.maxFeePerGas).toString()
      ).toBe('120');
      expect(
        transactions().find((tx: any) => tx.hash === REPLACEMENT)
      ).toMatchObject({
        isSpeedUp: true,
        smartAccountExecutionFrom: SMART,
        replacesHash: ORIGINAL,
        replacementRootHash: ORIGINAL,
      });
      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
      expect(
        jest.mocked(controllerEmitter).mock.calls.map(([route]) => route)
      ).toEqual([
        ['wallet', 'speedUpEvmTransaction'],
        ['wallet', 'setEvmTransactionAsAccelerated'],
      ]);
    }
  );

  it.each([
    'missing payer',
    'missing owner',
    'wrong owner chain',
    'wrong caller signer',
    'superseded original',
    'replacement status',
  ])('refuses %s before RPC or credential access', async (failure) => {
    if (failure === 'missing payer') mockState.vault.accounts.HDAccount = {};
    if (failure === 'missing owner')
      transactions()[0].smartAccountExecutionFrom = undefined;
    if (failure === 'wrong owner chain')
      mockState.vault.accounts.SmartAccount[7].smartAccount.chainId = 1;
    if (failure === 'superseded original') transactions()[0].isReplaced = true;
    if (failure === 'replacement status') transactions()[0].status = 'replaced';
    await run(false, failure === 'wrong caller signer' ? TARGET : PAYER);
    expect(alert.error).toHaveBeenCalled();
    expect(provider.getTransaction).not.toHaveBeenCalled();
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { hash: REPLACEMENT },
    { from: TARGET },
    { nonce: 9 },
    { chainId: 1 },
    { to: SMART },
    { value: BigNumber.from(8) },
    { data: '0xabcd' },
    { blockNumber: 123 },
  ])('refuses changed RPC original %j before signing', async (fields) => {
    provider.getTransaction.mockResolvedValue(rawOriginal(fields));
    await run();
    expect(alert.error).toHaveBeenCalled();
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it.each(['account', 'RPC', 'chain', 'provider', 'session', 'payer'])(
    'refuses a %s change during original lookup',
    async (axis) => {
      const pending = deferred<any>();
      const started = deferred<void>();
      provider.getTransaction.mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
      const sending = run();
      await started.promise;
      if (axis === 'account')
        mockState.vault.activeAccount = { ...owner, id: 8 };
      if (axis === 'RPC') mockState.vault.activeNetwork.url = 'rpc-b';
      if (axis === 'chain') mockState.vault.activeNetwork.chainId = 1;
      if (axis === 'provider') currentProvider = {};
      if (axis === 'session') wallet.walletSessionGeneration++;
      if (axis === 'payer')
        mockState.vault.accounts.HDAccount[3].address = TARGET;
      pending.resolve(rawOriginal());
      await sending;
      expect(alert.error).toHaveBeenCalled();
      expect(aes.decrypt).not.toHaveBeenCalled();
      expect(provider.sendTransaction).not.toHaveBeenCalled();
    }
  );

  it('blocks software signing/broadcast when context changes after credential handoff', async () => {
    jest
      .mocked(sendLocalEvmTransaction)
      .mockImplementationOnce(
        async (_provider, _key, _tx, beforeBroadcast, beforeSign) => {
          wallet.walletSessionGeneration++;
          beforeSign?.();
          beforeBroadcast?.();
          return response as any;
        }
      );
    await run();
    expect(aes.decrypt).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('blocks credential access and signing when the original mines during a delayed fee read', async () => {
    const pending = deferred<any>();
    const started = deferred<void>();
    provider.getBalance.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise;
    });
    const sending = run();
    await started.promise;
    transactions()[0].blockNumber = 123;
    transactions()[0].confirmations = 1;
    pending.resolve(BigNumber.from('1000000000'));
    await sending;
    expect(aes.decrypt).not.toHaveBeenCalled();
    expect(sendLocalEvmTransaction).not.toHaveBeenCalled();
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('discards a valid hardware signature when the original is superseded during the device request', async () => {
    // A deterministic test key provides a valid signature without any real wallet.
    const hardwareWallet = new Wallet(`0x${'01'.repeat(32)}`);
    const hardwareAddress = hardwareWallet.address.toLowerCase();
    mockState.vault.accounts.HDAccount = {};
    mockState.vault.accounts.Ledger = {
      4: { id: 4, address: hardwareAddress },
    };
    transactions()[0].from = hardwareAddress;
    provider.getTransaction.mockResolvedValue(
      rawOriginal({ from: hardwareAddress })
    );
    const pending = deferred<void>();
    const started = deferred<void>();
    const sign = jest.fn(async ({ rawTx }) => {
      started.resolve();
      await pending.promise;
      const signature = hardwareWallet.signingKey.sign(
        Transaction.from(`0x${rawTx}`).unsignedHash
      );
      return {
        r: signature.r.slice(2),
        s: signature.s.slice(2),
        v: signature.v.toString(16),
      };
    });
    keyring.ledgerSigner.evm = { signEVMTransaction: sign };
    const sending = run(false, hardwareAddress);
    await started.promise;
    transactions()[0].isReplaced = true;
    transactions()[0].status = 'replaced';
    pending.resolve();
    await sending;
    expect(sign).toHaveBeenCalledTimes(1);
    expect(provider.sendTransaction).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('waits for history persistence after broadcast before reporting success', async () => {
    const saved = deferred<void>();
    const started = deferred<void>();
    mockPersist.mockImplementationOnce(() => {
      started.resolve();
      return saved.promise;
    });
    const sending = run();
    await started.promise;
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(alert.success).not.toHaveBeenCalled();
    saved.resolve();
    await sending;
    expect(alert.success).toHaveBeenCalledTimes(1);
  });

  it('retains the acknowledged hash on a history save failure without sending again', async () => {
    mockPersist.mockRejectedValueOnce(new Error('Storage failed'));
    await expect(run()).resolves.toBe(REPLACEMENT);
    expect(alert.warning).toHaveBeenCalledWith(
      `transactions.replacementHistoryWarning: ${REPLACEMENT}`
    );
    expect(alert.error).not.toHaveBeenCalled();
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('retains the acknowledged hash when the UI account changes after broadcast', async () => {
    provider.sendTransaction.mockImplementationOnce(async () => {
      mockState.vault.activeAccount = {
        type: KeyringAccountType.HDAccount,
        id: 3,
      };
      wallet.walletSessionGeneration++;
      return response;
    });
    await expect(run()).resolves.toBe(REPLACEMENT);
    expect(alert.warning).toHaveBeenCalledWith(
      `transactions.replacementHistoryWarning: ${REPLACEMENT}`
    );
    expect(alert.error).not.toHaveBeenCalled();
    expect(provider.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockPersist).not.toHaveBeenCalled();
  });
});
