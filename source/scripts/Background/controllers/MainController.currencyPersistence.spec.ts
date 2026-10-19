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

import { loadState, walletPersistenceGate } from 'state/paliStorage';
import { setPrices } from 'state/price';
import store, { persistMainStateStrict } from 'state/store';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44, setHasEthProperty } from 'state/vaultGlobal';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

describe('currency preference durable completion', () => {
  let wallet: any;
  let disk: Record<string, any>;
  let writes: jest.SpyInstance;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    store.dispatch(
      setActiveSlip44(store.getState().vault.activeNetwork.slip44)
    );
    store.dispatch(setHasEthProperty(false));
    store.dispatch(setPrices({ asset: 'usd', price: 10 }));
    disk = {};
    writes = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (key, value) => {
        disk[key] = structuredClone(value);
      });
    jest
      .spyOn(chromeStorage, 'getItem')
      .mockImplementation(async (key) => structuredClone(disk[key] ?? null));
    await persistMainStateStrict();
    writes.mockClear();
    wallet = Object.create(MainController.prototype);
    wallet.fiatQuoteGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.getTokenPriceData = jest.fn().mockResolvedValue({ price: 20 });
    wallet.getUtxoPriceData = jest.fn().mockResolvedValue({ price: 20 });
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    jest.restoreAllMocks();
  });

  const holdWrite = () => {
    const storage = deferred<void>();
    writes.mockImplementationOnce(async (key, value) => {
      await storage.promise;
      disk[key] = structuredClone(value);
    });
    return storage;
  };

  it('waits for storage before publishing, then restores the saved currency from disk', async () => {
    const storage = holdWrite();
    let completed = false;
    const saving = wallet.saveFiatCurrency('eur').then(() => {
      completed = true;
    });
    await flush();
    expect(completed).toBe(false);
    expect(store.getState().price.fiat).toEqual({ asset: 'usd', price: 10 });
    expect((await loadState()).price.fiat.asset).toBe('usd');
    storage.resolve();
    await saving;
    expect(store.getState().price.fiat).toMatchObject({
      asset: 'eur',
      price: 20,
    });
    expect((await loadState()).price.fiat).toEqual({ asset: 'eur', price: 0 });
  });

  it('preserves the saved preference and quote after storage failure and permits an explicit retry', async () => {
    writes.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(wallet.saveFiatCurrency('eur')).rejects.toThrow(
      'Storage unavailable'
    );
    expect(store.getState().price.fiat).toEqual({ asset: 'usd', price: 10 });
    expect((await loadState()).price.fiat.asset).toBe('usd');
    expect(wallet.getTokenPriceData).not.toHaveBeenCalled();
    expect(wallet.getUtxoPriceData).not.toHaveBeenCalled();
    await wallet.saveFiatCurrency('eur');
    expect((await loadState()).price.fiat.asset).toBe('eur');
  });

  it.each([true, false])(
    'keeps a queued emergency save consistent when storage succeeds=%s',
    async (succeeds) => {
      const storage = holdWrite();
      const saving = wallet.saveFiatCurrency('eur');
      const completion = succeeds
        ? expect(saving).resolves.toBeUndefined()
        : expect(saving).rejects.toThrow('Storage unavailable');
      await flush();
      store.dispatch(setHasEthProperty(true));
      const emergency = vaultCache.emergencySave();
      if (succeeds) storage.resolve();
      else storage.reject(new Error('Storage unavailable'));
      await completion;
      await emergency;
      expect(disk.state.price.fiat.asset).toBe(succeeds ? 'eur' : 'usd');
      expect(disk.state.vaultGlobal.hasEthProperty).toBe(true);
    }
  );

  it('repairs a completed write invalidated by wallet reset before releasing persistence ownership', async () => {
    const storage = holdWrite();
    const saving = wallet.saveFiatCurrency('eur');
    const rejected = expect(saving).rejects.toThrow('Wallet state changed');
    await flush();
    wallet.walletStateGeneration += 1;
    wallet.fiatQuoteGeneration += 1;
    store.dispatch(setPrices({ asset: 'cad', price: 0 }));
    storage.resolve();
    await rejected;
    expect(store.getState().price.fiat.asset).toBe('cad');
    expect((await loadState()).price.fiat.asset).toBe('cad');
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('rejects a queued preference from a reset wallet before it can write', async () => {
    const quote = deferred<{ price: number }>();
    wallet.getTokenPriceData.mockReturnValueOnce(quote.promise);
    wallet.getUtxoPriceData.mockReturnValueOnce(quote.promise);
    const refreshing = wallet.setFiat();
    await flush();
    const saving = wallet.saveFiatCurrency('eur');
    const rejected = expect(saving).rejects.toThrow('Wallet state changed');
    wallet.walletStateGeneration += 1;
    wallet.fiatQuoteGeneration += 1;
    quote.resolve({ price: 20 });
    await refreshing;
    await rejected;
    expect(writes).not.toHaveBeenCalled();
    expect(store.getState().price.fiat.asset).toBe('usd');
  });

  it('keeps periodic quote refreshes free of preference writes', async () => {
    await wallet.setFiat();
    expect(store.getState().price.fiat).toMatchObject({
      asset: 'usd',
      price: 20,
    });
    expect(writes).not.toHaveBeenCalled();
  });
});
