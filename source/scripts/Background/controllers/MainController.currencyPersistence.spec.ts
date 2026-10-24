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
const finishTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('currency preference durable completion', () => {
  let wallet: any;
  let disk: Record<string, any>;
  let writes: jest.SpyInstance;
  let refreshes: jest.SpyInstance;

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
    wallet.fiatPreferenceGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.getTokenPriceData = jest.fn().mockResolvedValue({ price: 20 });
    wallet.getUtxoPriceData = jest.fn().mockResolvedValue({ price: 20 });
    refreshes = jest.spyOn(wallet, 'setFiat');
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

  const holdQuotes = (
    replies: Record<string, ReturnType<typeof deferred<{ price: number }>>>
  ) => {
    const calls: string[] = [];
    const read = (_network: unknown, currency: string) => {
      calls.push(currency);
      if (!replies[currency]) throw new Error(`Unexpected quote: ${currency}`);
      return replies[currency].promise;
    };
    wallet.getTokenPriceData.mockImplementation(read);
    wallet.getUtxoPriceData.mockImplementation(read);
    return calls;
  };

  const finishRefreshes = async () => {
    await flush();
    await Promise.allSettled(
      refreshes.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value)
    );
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
    // Save acknowledges the durable preference, not completion of its quote.
    await finishRefreshes();
    expect(store.getState().price.fiat).toMatchObject({
      asset: 'eur',
      available: true,
      price: 20,
    });
    expect((await loadState()).price.fiat).toEqual({
      asset: 'eur',
      available: false,
      price: 0,
    });
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
    await finishRefreshes();
    expect((await loadState()).price.fiat.asset).toBe('eur');
  });

  it('acknowledges a durable preference while its own quote is still pending', async () => {
    const quote = deferred<{ price: number }>();
    const calls = holdQuotes({ eur: quote });
    let acknowledged = false;
    const saving = wallet.saveFiatCurrency('eur').then(() => {
      acknowledged = true;
    });
    try {
      await finishTurn();
      expect(calls).toEqual(['eur']);
      expect(acknowledged).toBe(true);
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      quote.resolve({ price: 21 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: true,
        price: 21,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
    } finally {
      quote.resolve({ price: 21 });
      await saving;
      await finishRefreshes();
    }
  });

  it('acknowledges a durable preference without waiting behind an older quote', async () => {
    const oldQuote = deferred<{ price: number }>();
    const newQuote = deferred<{ price: number }>();
    const calls = holdQuotes({ usd: oldQuote, eur: newQuote });
    const refreshing = wallet.setFiat();
    await flush();
    expect(calls).toEqual(['usd']);
    let acknowledged = false;
    const saving = wallet.saveFiatCurrency('eur').then(() => {
      acknowledged = true;
    });
    try {
      await finishTurn();
      expect(acknowledged).toBe(true);
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(calls).toEqual(['usd']);
      oldQuote.resolve({ price: 11 });
      await refreshing;
      await flush();
      expect(calls).toEqual(['usd', 'eur']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      newQuote.resolve({ price: 22 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: true,
        price: 22,
      });
    } finally {
      oldQuote.resolve({ price: 11 });
      newQuote.resolve({ price: 22 });
      await saving;
      await refreshing;
      await finishRefreshes();
    }
  });

  it('does not let an older in-flight quote overwrite a newer durable preference', async () => {
    const eurQuote = deferred<{ price: number }>();
    const gbpQuote = deferred<{ price: number }>();
    const calls = holdQuotes({ eur: eurQuote, gbp: gbpQuote });
    let eurAcknowledged = false;
    let gbpAcknowledged = false;
    const eurSave = wallet.saveFiatCurrency('eur').then(() => {
      eurAcknowledged = true;
    });
    await flush();
    const gbpSave = wallet.saveFiatCurrency('gbp').then(() => {
      gbpAcknowledged = true;
    });
    const observedAfterGbp: string[] = [];
    let unsubscribe: () => void = () => undefined;
    try {
      await finishTurn();
      expect(eurAcknowledged).toBe(true);
      expect(gbpAcknowledged).toBe(true);
      expect(calls).toEqual(['eur']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      unsubscribe = store.subscribe(() => {
        observedAfterGbp.push(store.getState().price.fiat.asset);
      });
      eurQuote.resolve({ price: 23 });
      await refreshes.mock.results[0].value;
      await flush();
      expect(calls).toEqual(['eur', 'gbp']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      expect(observedAfterGbp).not.toContain('eur');
      gbpQuote.resolve({ price: 24 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: true,
        price: 24,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      expect(observedAfterGbp).not.toContain('eur');
    } finally {
      unsubscribe();
      eurQuote.resolve({ price: 23 });
      gbpQuote.resolve({ price: 24 });
      await Promise.allSettled([eurSave, gbpSave]);
      await finishRefreshes();
    }
  });

  it('skips a superseded queued refresh before fetching its old currency', async () => {
    const usdQuote = deferred<{ price: number }>();
    const eurQuote = deferred<{ price: number }>();
    const gbpQuote = deferred<{ price: number }>();
    const calls = holdQuotes({ usd: usdQuote, eur: eurQuote, gbp: gbpQuote });
    const original = wallet.setFiat();
    await flush();
    expect(calls).toEqual(['usd']);
    let eurAcknowledged = false;
    let gbpAcknowledged = false;
    const eurSave = wallet.saveFiatCurrency('eur').then(() => {
      eurAcknowledged = true;
    });
    await flush();
    const gbpSave = wallet.saveFiatCurrency('gbp').then(() => {
      gbpAcknowledged = true;
    });
    try {
      await finishTurn();
      expect(eurAcknowledged).toBe(true);
      expect(gbpAcknowledged).toBe(true);
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      usdQuote.resolve({ price: 12 });
      await original;
      await flush();
      expect(calls).toEqual(['usd', 'gbp']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: false,
        price: 0,
      });
      gbpQuote.resolve({ price: 25 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'gbp',
        available: true,
        price: 25,
      });
    } finally {
      usdQuote.resolve({ price: 12 });
      eurQuote.resolve({ price: 99 });
      gbpQuote.resolve({ price: 25 });
      await Promise.allSettled([original, eurSave, gbpSave]);
      await finishRefreshes();
    }
  });

  it('does not revive an old quote after saving EUR to GBP and back to EUR', async () => {
    const oldEurQuote = deferred<{ price: number }>();
    const currentEurQuote = deferred<{ price: number }>();
    const calls: string[] = [];
    const read = (_network: unknown, currency: string) => {
      calls.push(currency);
      if (currency !== 'eur') return Promise.resolve({ price: 99 });
      return calls.filter((value) => value === 'eur').length === 1
        ? oldEurQuote.promise
        : currentEurQuote.promise;
    };
    wallet.getTokenPriceData.mockImplementation(read);
    wallet.getUtxoPriceData.mockImplementation(read);
    let firstAcknowledged = false;
    let secondAcknowledged = false;
    let thirdAcknowledged = false;
    const firstSave = wallet.saveFiatCurrency('eur').then(() => {
      firstAcknowledged = true;
    });
    let secondSave: Promise<void> = Promise.resolve();
    let thirdSave: Promise<void> = Promise.resolve();
    let unsubscribe: () => void = () => undefined;
    const observedAfterReturn: number[] = [];
    try {
      await finishTurn();
      expect(firstAcknowledged).toBe(true);
      expect(calls).toEqual(['eur']);
      secondSave = wallet.saveFiatCurrency('gbp').then(() => {
        secondAcknowledged = true;
      });
      await finishTurn();
      expect(secondAcknowledged).toBe(true);
      thirdSave = wallet.saveFiatCurrency('eur').then(() => {
        thirdAcknowledged = true;
      });
      await finishTurn();
      expect(thirdAcknowledged).toBe(true);
      expect(calls).toEqual(['eur']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      unsubscribe = store.subscribe(() => {
        observedAfterReturn.push(store.getState().price.fiat.price);
      });
      oldEurQuote.resolve({ price: 27 });
      await refreshes.mock.results[0].value;
      await finishTurn();
      // Currency equality alone would admit 27 here. Only the new EUR epoch
      // may publish; the intervening queued GBP quote must not even start.
      expect(calls).toEqual(['eur', 'eur']);
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(observedAfterReturn).not.toContain(27);
      currentEurQuote.resolve({ price: 28 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: true,
        price: 28,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(observedAfterReturn).not.toContain(27);
    } finally {
      unsubscribe();
      oldEurQuote.resolve({ price: 27 });
      currentEurQuote.resolve({ price: 28 });
      await Promise.allSettled([firstSave, secondSave, thirdSave]);
      await finishRefreshes();
    }
  });

  it('keeps an earlier successful in-flight quote valid when a newer preference write fails', async () => {
    const eurQuote = deferred<{ price: number }>();
    const calls = holdQuotes({ eur: eurQuote });
    const eurSave = wallet.saveFiatCurrency('eur');
    try {
      await flush();
      expect(calls).toEqual(['eur']);
      writes.mockRejectedValueOnce(new Error('Storage unavailable'));
      await expect(wallet.saveFiatCurrency('gbp')).rejects.toThrow(
        'Storage unavailable'
      );
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(calls).toEqual(['eur']);
      eurQuote.resolve({ price: 26 });
      await finishRefreshes();
      expect(store.getState().price.fiat).toEqual({
        asset: 'eur',
        available: true,
        price: 26,
      });
      expect((await loadState()).price.fiat).toEqual({
        asset: 'eur',
        available: false,
        price: 0,
      });
      expect(calls).toEqual(['eur']);
    } finally {
      eurQuote.resolve({ price: 26 });
      await eurSave;
      await finishRefreshes();
    }
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
      await finishRefreshes();
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
    // Preference writes no longer queue behind price I/O. Hold the actual
    // persistence lock so this still tests a genuinely queued, stale Save.
    const storage = holdWrite();
    const existingWrite = persistMainStateStrict();
    await flush();
    const saving = wallet.saveFiatCurrency('eur');
    const rejected = expect(saving).rejects.toThrow('Wallet state changed');
    wallet.walletStateGeneration += 1;
    wallet.fiatQuoteGeneration += 1;
    storage.resolve();
    await existingWrite;
    await rejected;
    expect(writes).toHaveBeenCalledTimes(1);
    expect((await loadState()).price.fiat.asset).toBe('usd');
    expect(store.getState().price.fiat.asset).toBe('usd');
    expect(wallet.getTokenPriceData).not.toHaveBeenCalled();
    expect(wallet.getUtxoPriceData).not.toHaveBeenCalled();
  });

  it('keeps periodic quote refreshes free of preference writes', async () => {
    await wallet.setFiat();
    expect(store.getState().price.fiat).toMatchObject({
      asset: 'usd',
      available: true,
      price: 20,
    });
    expect(writes).not.toHaveBeenCalled();
  });
});
