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
  PsbtUtils: {},
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import store from 'state/store';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType } from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const network = {
  chainId: 31337,
  currency: 'TEST',
  kind: INetworkType.Ethereum,
  label: 'Synthetic local chain',
  slip44: 60,
  url: 'http://127.0.0.1:18545',
};
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('custom-network registration concurrency', () => {
  let state: any;
  let wallet: any;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    state = { vaultGlobal: { networks: { ethereum: {}, syscoin: {} } } };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      state = { vaultGlobal: vaultGlobalReducer(state.vaultGlobal, action) };
      return action;
    });
    wallet = Object.create(MainController.prototype);
    wallet.walletStateGeneration = 0;
    wallet.isRemovingNetwork = false;
    wallet.resetAutoLockTimer = jest.fn();
    jest.mocked(chromeStorage.setItem).mockReset().mockResolvedValue(undefined);
    wallet.evmAssetsController = {
      detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['success', 'failure'])(
    'rejects pre-reset metadata discovery after %s without modifying the new wallet',
    async (result) => {
      const pending = deferred();
      wallet.evmAssetsController.detectCoinGeckoIds.mockReturnValueOnce(
        pending.promise
      );
      const adding = wallet.addCustomRpc(network);
      const rejected = expect(adding).rejects.toThrow('Wallet state changed');
      wallet.walletStateGeneration += 1;
      const replacement = {
        ...network,
        chainId: 31338,
        label: 'Replacement wallet network',
      };
      state.vaultGlobal.networks = {
        ethereum: { [replacement.chainId]: replacement },
        syscoin: {},
      };
      if (result === 'success') pending.resolve({ coingeckoId: 'obsolete' });
      else pending.reject(new Error('Metadata unavailable'));
      await rejected;
      expect(state.vaultGlobal.networks.ethereum).toEqual({
        [replacement.chainId]: replacement,
      });
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
    }
  );

  it('saves a healthy add and rejects a later duplicate before discovery', async () => {
    await expect(wallet.addCustomRpc(network)).resolves.toMatchObject(network);
    await expect(
      wallet.addCustomRpc({ ...network, url: 'http://127.0.0.1:28545' })
    ).rejects.toThrow('network already exists, remove or edit it');
    expect(state.vaultGlobal.networks.ethereum[31337].url).toBe(network.url);
    expect(wallet.evmAssetsController.detectCoinGeckoIds).toHaveBeenCalledTimes(
      1
    );
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it.each(['added', 'edited', 'discovery failed'])(
    'preserves a newer %s registration when an earlier discovery settles',
    async (scenario) => {
      const pending = deferred();
      wallet.evmAssetsController.detectCoinGeckoIds.mockImplementationOnce(
        () => pending.promise
      );
      const earlier = wallet.addCustomRpc(network);
      const rejected = expect(earlier).rejects.toThrow(
        'network already exists, remove or edit it'
      );
      const other = {
        ...network,
        label: 'Other approved config',
        url: 'http://127.0.0.1:28545',
      };
      await wallet.addCustomRpc(other);
      const saved =
        scenario === 'edited'
          ? { ...other, url: 'http://127.0.0.1:38545' }
          : other;
      if (scenario === 'edited') await wallet.editCustomRpc(saved);
      const dispatches = jest.mocked(store.dispatch).mock.calls.length;
      const saves = jest.mocked(chromeStorage.setItem).mock.calls.length;

      if (scenario === 'discovery failed')
        pending.reject(new Error('Metadata unavailable'));
      else pending.resolve({ coingeckoId: 'obsolete-metadata' });
      await rejected;

      expect(state.vaultGlobal.networks.ethereum[31337]).toMatchObject(saved);
      expect(state.vaultGlobal.networks.ethereum[31337].coingeckoId).toBe(
        undefined
      );
      expect(store.dispatch).toHaveBeenCalledTimes(dispatches);
      expect(chromeStorage.setItem).toHaveBeenCalledTimes(saves);
    }
  );

  it('allows distinct chains to register while discovery completes out of order', async () => {
    const pending = deferred();
    wallet.evmAssetsController.detectCoinGeckoIds.mockImplementationOnce(
      () => pending.promise
    );
    const earlier = wallet.addCustomRpc(network);
    const other = { ...network, chainId: 31338 };
    await wallet.addCustomRpc(other);
    pending.resolve({ coingeckoId: 'synthetic-asset' });
    await expect(earlier).resolves.toMatchObject({
      ...network,
      coingeckoId: 'synthetic-asset',
    });
    expect(state.vaultGlobal.networks.ethereum[31337]).toMatchObject(network);
    expect(state.vaultGlobal.networks.ethereum[31338]).toMatchObject(other);
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('still adds a new chain if optional metadata discovery fails', async () => {
    wallet.evmAssetsController.detectCoinGeckoIds.mockRejectedValueOnce(
      new Error('Metadata unavailable')
    );
    await expect(wallet.addCustomRpc(network)).resolves.toMatchObject(network);
    expect(state.vaultGlobal.networks.ethereum[31337]).toMatchObject(network);
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('retains removal ownership precedence when discovery settles', async () => {
    const pending = deferred();
    wallet.evmAssetsController.detectCoinGeckoIds.mockImplementationOnce(
      () => pending.promise
    );
    const earlier = wallet.addCustomRpc(network);
    const rejected = expect(earlier).rejects.toThrow('Network removal');
    wallet.isRemovingNetwork = true;
    pending.resolve(null);
    await rejected;
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });
});
