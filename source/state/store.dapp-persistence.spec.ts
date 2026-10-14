const storageGetMock = jest.fn<Promise<any>, any[]>(async () => null);
const storageSetMock = jest.fn();

jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => storageGetMock(...args),
    setItem: (...args: any[]) => storageSetMock(...args),
  },
}));

import { INetworkType, KeyringAccountType } from 'types/network';

import { addDApp } from './dapp';
import { walletPersistenceGate } from './paliStorage';
import store, { persistMainStateStrict, saveMainState } from './store';

describe('strict main-state persistence for permission changes', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    walletPersistenceGate.blocked = false;
    storageSetMock.mockResolvedValue(undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    errorSpy.mockRestore();
  });

  it('writes directly even when the legacy unchanged-state result is false', async () => {
    await persistMainStateStrict();
    expect(await saveMainState()).toBe(false);
    storageSetMock.mockClear();

    await persistMainStateStrict();

    expect(storageSetMock).toHaveBeenCalledTimes(1);
    const [key, saved] = storageSetMock.mock.calls[0];
    expect(key).toBe('state');
    expect(Object.keys(saved).sort()).toEqual(['dapp', 'price', 'vaultGlobal']);
    expect(saved.dapp).toBe(store.getState().dapp);
  });

  it('rejects a blocked save instead of treating legacy false as success', async () => {
    walletPersistenceGate.blocked = true;
    expect(await saveMainState()).toBe(false);
    await expect(persistMainStateStrict()).rejects.toThrow('Wallet recovery');
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  it('propagates an actual storage error even after best-effort caching hides it', async () => {
    store.dispatch(
      addDApp({
        host: 'https://persistence-failure.example',
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        chain: INetworkType.Ethereum,
        chainId: 57057,
        date: 1,
      })
    );
    const failure = new Error('Storage unavailable');
    storageSetMock.mockRejectedValueOnce(failure);
    // Legacy saveState swallows this error and saveMainState returns true.
    expect(await saveMainState()).toBe(true);
    storageSetMock.mockRejectedValueOnce(failure);

    await expect(persistMainStateStrict()).rejects.toBe(failure);
    expect(storageSetMock).toHaveBeenCalledTimes(2);
  });
});
