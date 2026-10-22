import { chromeStorage } from 'utils/storageAPI';

import { walletPersistenceGate } from './paliStorage';
import store, {
  persistHasEthProperty,
  persistMainStateStrict,
  saveMainState,
} from './store';
import { setHasEthProperty, setTransactionHistoryStatus } from './vaultGlobal';

describe('transient transaction history status persistence', () => {
  let disk: any;
  let writes: jest.SpyInstance;

  beforeEach(async () => {
    walletPersistenceGate.blocked = false;
    writes = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (_key, value) => {
        disk = structuredClone(value);
      });
    store.dispatch(setTransactionHistoryStatus(undefined));
    await persistMainStateStrict();
    writes.mockClear();
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    jest.restoreAllMocks();
  });

  it.each(['pending', 'ready', 'error'] as const)(
    'does not persist a %s status or make a status-only save dirty',
    async (state) => {
      store.dispatch(
        setTransactionHistoryStatus({
          scope: { account: 'synthetic-account', network: 'synthetic-network' },
          requestId: 1,
          state,
        })
      );
      await expect(saveMainState()).resolves.toBe(false);
      expect(writes).not.toHaveBeenCalled();
      await persistMainStateStrict();
      expect(disk.vaultGlobal).not.toHaveProperty('transactionHistoryStatus');
      expect(store.getState().vaultGlobal.transactionHistoryStatus?.state).toBe(
        state
      );
    }
  );

  it('normalizes both live cached and current state while still saving unrelated changes', async () => {
    store.dispatch(
      setTransactionHistoryStatus({
        scope: { account: 'synthetic-account', network: 'synthetic-network' },
        requestId: 1,
        state: 'pending',
      })
    );
    store.dispatch(
      setHasEthProperty(!store.getState().vaultGlobal.hasEthProperty)
    );
    await expect(saveMainState()).resolves.toBe(true);
    expect(disk.vaultGlobal).not.toHaveProperty('transactionHistoryStatus');
    const saved = disk.vaultGlobal.hasEthProperty;
    writes.mockClear();
    store.dispatch(
      setTransactionHistoryStatus({
        scope: { account: 'synthetic-account', network: 'synthetic-network' },
        requestId: 2,
        state: 'ready',
      })
    );
    await expect(saveMainState()).resolves.toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(disk.vaultGlobal.hasEthProperty).toBe(saved);
  });

  it.each(['pending', 'ready', 'error'] as const)(
    'keeps %s history transient through the actual provider preference writer',
    async (state) => {
      store.dispatch(
        setTransactionHistoryStatus({
          scope: { account: 'synthetic-account', network: 'synthetic-network' },
          requestId: 3,
          state,
        })
      );
      const enabled = !store.getState().vaultGlobal.hasEthProperty;
      await persistHasEthProperty(enabled);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(disk.vaultGlobal.hasEthProperty).toBe(enabled);
      expect(store.getState().vaultGlobal.hasEthProperty).toBe(enabled);
      expect(store.getState().vaultGlobal.transactionHistoryStatus?.state).toBe(
        state
      );
      expect(disk.vaultGlobal).not.toHaveProperty('transactionHistoryStatus');
    }
  );
});
