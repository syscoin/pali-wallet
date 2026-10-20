jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: {},
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

import { KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const TYPE = KeyringAccountType.HDAccount;
const METADATA = {
  name: 'Synthetic',
  symbol: 'UNIT',
  decimals: 6,
  balance: '10',
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
let mockState: any;
let wallet: any;
let provider: any;
let read: jest.Mock;
let expectedContext: any;
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { type: TYPE, id: 0 },
      accounts: {
        [TYPE]: { 0: { address: ADDRESS }, 1: { address: ADDRESS } },
      },
      activeNetwork: { chainId: 1, url: 'https://rpc-a.example' },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  provider = { name: 'provider-a' };
  read = jest.fn().mockResolvedValue(METADATA);
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 7;
  wallet.getActiveKeyring = jest.fn(() => ({
    ethereumTransaction: { web3Provider: provider },
  }));
  wallet.evmAssetsController = {
    getERC20TokenInfo: read,
    getTokenDetails: read,
  };
  // Real existing assertion: no mocked context verdict.
  // Only the lower metadata I/O is stubbed; no provider calls are made.
  wallet.smartAccount = new SmartAccountController({
    getEthereumTransaction: () => wallet.ethereumTransaction,
    getWalletSessionGeneration: () => wallet.getWalletSessionGeneration(),
  } as any);
  expectedContext = {
    account: { type: TYPE, id: 0, address: ADDRESS },
    chainId: 1,
    rpcUrl: 'https://rpc-a.example',
    slip44: 60,
    sessionGeneration: 7,
  };
});

describe.each(['getERC20TokenInfo', 'getTokenDetails'])(
  '%s approval metadata admission',
  (method) => {
    const request = (context: any = expectedContext) =>
      wallet[method](TOKEN, ADDRESS, context);

    it('preserves a healthy scoped read and captures its provider', async () => {
      const captured = provider;
      await expect(request()).resolves.toBe(METADATA);
      expect(read).toHaveBeenCalledWith(TOKEN, ADDRESS, captured);
    });

    it('preserves a legacy unscoped caller in its current context', async () => {
      mockState.vault.activeNetwork = {
        chainId: 2,
        url: 'https://rpc-b.example',
      };
      provider = { name: 'provider-b' };
      await expect(wallet[method](TOKEN, ADDRESS)).resolves.toBe(METADATA);
      expect(read).toHaveBeenCalledWith(TOKEN, ADDRESS, provider);
    });

    it('accepts an internal approved context without a serialized session generation', async () => {
      const internalContext = {
        ...expectedContext,
        sessionGeneration: undefined,
      };
      await expect(request(internalContext)).resolves.toBe(METADATA);
    });

    it('rejects an A request admitted on B even when A is restored before the reply', async () => {
      // The message is created on A, but not dispatched until B is active.
      const queued = () => request();
      const held = deferred<typeof METADATA>();
      read.mockImplementation(() => held.promise);
      const networkA = mockState.vault.activeNetwork;
      const providerA = provider;
      mockState.vault.activeNetwork = {
        chainId: 2,
        url: 'https://rpc-b.example',
      };
      provider = { name: 'provider-b' };
      const pending = queued();
      mockState.vault.activeNetwork = networkA;
      provider = providerA;
      held.resolve({ ...METADATA, decimals: 18 });
      await expect(pending).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(read).not.toHaveBeenCalled();
      expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
    });

    it('rejects an account argument that differs from the approved address', async () => {
      await expect(
        wallet[method](TOKEN, TOKEN, expectedContext)
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(read).not.toHaveBeenCalled();
    });

    it.each([
      'chain',
      'rpc',
      'account-id',
      'account-type',
      'address',
      'kind',
      'slip44',
      'session',
    ])('rejects %s drift before lower metadata I/O', async (change) => {
      if (change === 'chain') mockState.vault.activeNetwork.chainId = 2;
      if (change === 'rpc')
        mockState.vault.activeNetwork.url = 'https://rpc-b.example';
      if (change === 'account-id') mockState.vault.activeAccount.id = 1;
      if (change === 'account-type') {
        mockState.vault.accounts.Imported = { 0: { address: ADDRESS } };
        mockState.vault.activeAccount.type = 'Imported';
      }
      if (change === 'address')
        mockState.vault.accounts[TYPE][0].address = TOKEN;
      if (change === 'kind') mockState.vault.isBitcoinBased = true;
      if (change === 'slip44') mockState.vaultGlobal.activeSlip44 = 1;
      if (change === 'session') wallet.walletSessionGeneration += 1;
      await expect(request()).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
      expect(read).not.toHaveBeenCalled();
      expect(wallet.getActiveKeyring).not.toHaveBeenCalled();
    });

    it('rejects a provider replacement while the captured read is pending', async () => {
      const held = deferred<typeof METADATA>();
      read.mockImplementationOnce(() => held.promise);
      const captured = provider;
      const pending = request();
      expect(read).toHaveBeenCalledWith(TOKEN, ADDRESS, captured);
      provider = { name: 'replacement-provider-a' };
      held.resolve(METADATA);
      await expect(pending).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    });

    it('rejects an A-B-A wallet session after lower metadata I/O starts', async () => {
      const held = deferred<typeof METADATA>();
      read.mockImplementationOnce(() => held.promise);
      const pending = request();
      wallet.walletSessionGeneration += 2;
      held.resolve(METADATA);
      await expect(pending).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    });

    it('rejects changed context after lower metadata I/O starts', async () => {
      const held = deferred<typeof METADATA>();
      read.mockImplementationOnce(() => held.promise);
      const pending = request();
      mockState.vault.activeNetwork.chainId = 2;
      held.resolve(METADATA);
      await expect(pending).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    });

    it('preserves a metadata error when the approved context is still current', async () => {
      const error = new Error('Synthetic metadata failure');
      read.mockRejectedValueOnce(error);
      await expect(request()).rejects.toBe(error);
    });

    it('reports the context change when an old provider read rejects', async () => {
      let reject!: (error: Error) => void;
      read.mockImplementationOnce(
        () => new Promise((_resolve, fail) => (reject = fail))
      );
      const pending = request();
      mockState.vault.activeNetwork.chainId = 2;
      reject(new Error('Synthetic aborted metadata read'));
      await expect(pending).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    });
  }
);
