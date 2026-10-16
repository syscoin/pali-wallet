jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { notifyTransaction: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({
  blacklistService: { checkAddress: jest.fn() },
}));
jest.mock('utils/navigationState', () => ({
  clearNavigationState: jest.fn(),
  clearTransactionNavigationState: jest.fn(),
}));

import { getController, notificationManager } from '..';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';
import { clearTransactionNavigationState } from 'utils/navigationState';
import { blacklistService } from 'utils/security/blacklistService';

import MainController from './MainController';

const ADDRESS = `0x${'11'.repeat(20)}`;
const RECEIVER = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const RESPONSE = { hash: `0x${'44'.repeat(32)}`, nonce: 7 };
const TYPE = KeyringAccountType.HDAccount;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
let mockState: any;

describe.each([
  ['ERC20', 'sendSignedErc20Transaction'],
  ['ERC721', 'sendSignedErc721Transaction'],
  ['ERC1155', 'sendSignedErc1155Transaction'],
] as const)('%s token submission persistence scope', (standard, sdkMethod) => {
  let wallet: any;
  let sdk: jest.Mock;
  const params = { receiver: RECEIVER, tokenAddress: TOKEN, tokenAmount: '1' };
  const send = () => wallet.sendAndSaveTokenTransaction(standard, params);
  const mutate = (change: string) => {
    if (change === 'account') mockState.vault.activeAccount.id = 1;
    if (change === 'network') mockState.vault.activeNetwork.chainId = 1;
    if (change === 'RPC') mockState.vault.activeNetwork.url = 'rpc-b';
    if (change === 'mode') mockState.vault.isBitcoinBased = true;
    if (change === 'slip44') mockState.vaultGlobal.activeSlip44 = 57;
    if (change === 'session') wallet.walletSessionGeneration += 1;
    if (change === 'setup') wallet.isCreatingWallet = true;
    if (change === 'address')
      mockState.vault.accounts[TYPE][0].address = RECEIVER;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      vault: {
        isBitcoinBased: false,
        activeAccount: { id: 0, type: TYPE },
        accounts: {
          [TYPE]: { 0: { address: ADDRESS }, 1: { address: RECEIVER } },
        },
        activeNetwork: {
          kind: 'ethereum',
          chainId: 57057,
          url: 'rpc-a',
        },
      },
      vaultGlobal: { activeSlip44: 60 },
    };
    sdk = jest.fn(async () => RESPONSE);
    const keyring = {
      isUnlocked: () => true,
      ethereumTransaction: { [sdkMethod]: sdk },
    };
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 7;
    wallet.getActiveKeyring = jest.fn(() => keyring);
    wallet.saveWalletState = jest.fn(async () => undefined);
    wallet.startRapidTransactionPolling = jest.fn();
    (getController as jest.Mock).mockReturnValue({ wallet });
    jest.mocked(blacklistService.checkAddress).mockResolvedValue({
      isBlacklisted: false,
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('saves one unchanged ACK to the captured original account and chain', async () => {
    await expect(send()).resolves.toBe(RESPONSE);
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(sdk).toHaveBeenCalledWith(params);
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          accountId: 0,
          accountType: TYPE,
          chainId: 57057,
          networkType: 'ethereum',
          transaction: expect.objectContaining({
            hash: RESPONSE.hash,
            balanceRefreshTokenAddresses: [TOKEN],
          }),
        }),
      })
    );
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
    expect(wallet.startRapidTransactionPolling).toHaveBeenCalledWith(
      RESPONSE.hash,
      57057,
      false,
      { id: 0, type: TYPE }
    );
  });

  it.each([
    'account',
    'network',
    'RPC',
    'mode',
    'slip44',
    'session',
    'setup',
    'address',
  ])(
    'retains the published ACK without stale writes after a pending %s change',
    async (change) => {
      const entered = deferred<void>();
      const ack = deferred<typeof RESPONSE>();
      sdk.mockImplementationOnce(() => {
        entered.resolve();
        return ack.promise;
      });
      const sending = send();
      await entered.promise;
      mutate(change);
      ack.resolve(RESPONSE);
      await expect(sending).resolves.toBe(RESPONSE);
      expect(sdk).toHaveBeenCalledTimes(1);
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(notificationManager.notifyTransaction).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
      expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
      expect(clearTransactionNavigationState).not.toHaveBeenCalled();
    }
  );

  it('rejects a changed approval after blacklist I/O before calling the SDK signer', async () => {
    const entered = deferred<void>();
    const lookup = deferred<any>();
    jest.mocked(blacklistService.checkAddress).mockImplementationOnce(() => {
      entered.resolve();
      return lookup.promise;
    });
    const sending = send();
    const rejection = expect(sending).rejects.toMatchObject({
      message: EVM_TRANSACTION_CONTEXT_CHANGED,
      transactionNotBroadcast: true,
    });
    await entered.promise;
    mutate('account');
    lookup.resolve({ isBlacklisted: false });
    await rejection;
    expect(sdk).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('does not turn a notification failure after ACK into a missing transaction hash', async () => {
    jest
      .mocked(notificationManager.notifyTransaction)
      .mockImplementationOnce(() => {
        throw new Error('Notification fixture failed');
      });
    const errors = jest.spyOn(console, 'error').mockImplementation();
    await expect(send()).resolves.toBe(RESPONSE);
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
  });

  it.each(['session', 'network'])(
    'does not clean another screen or start polling after %s changes during persistence',
    async (change) => {
      const entered = deferred<void>();
      const saved = deferred<void>();
      wallet.saveWalletState.mockImplementationOnce(() => {
        entered.resolve();
        return saved.promise;
      });
      const sending = send();
      await entered.promise;
      mutate(change);
      saved.resolve();
      await expect(sending).resolves.toBe(RESPONSE);
      expect(store.dispatch).toHaveBeenCalledTimes(1);
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            accountId: 0,
            accountType: TYPE,
            chainId: 57057,
          }),
        })
      );
      expect(wallet.startRapidTransactionPolling).not.toHaveBeenCalled();
      expect(clearTransactionNavigationState).not.toHaveBeenCalled();
    }
  );
});
