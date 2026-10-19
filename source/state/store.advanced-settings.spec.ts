import { chromeStorage } from 'utils/storageAPI';

import { walletPersistenceGate } from './paliStorage';
import store, {
  persistAdvancedSetting,
  persistMainStateStrict,
  saveMainState,
} from './store';
import { setAdvancedSettings, setHasEthProperty } from './vaultGlobal';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};

describe('staged advanced preference persistence', () => {
  let disk: any;
  let writes: jest.SpyInstance;

  beforeEach(async () => {
    walletPersistenceGate.blocked = false;
    store.dispatch(setHasEthProperty(false));
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 5 })
    );
    writes = jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (_key, value) => {
        disk = structuredClone(value);
      });
    await persistMainStateStrict();
    writes.mockClear();
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    jest.restoreAllMocks();
  });

  it.each([true, false])(
    'keeps a queued ordinary save consistent when settings storage succeeds=%s',
    async (succeeds) => {
      const storage = deferred();
      writes.mockImplementationOnce(async (_key, state) => {
        await storage.promise;
        disk = structuredClone(state);
      });
      const setting = persistAdvancedSetting('autolock', 10, () => true);
      const completion = succeeds
        ? expect(setting).resolves.toBeUndefined()
        : expect(setting).rejects.toThrow('Storage unavailable');
      await flush();
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(5);
      expect(disk.vaultGlobal.advancedSettings.autolock).toBe(5);
      // This independent Redux change forces the queued background save to
      // write, so the failure case cannot pass by skipping an unchanged save.
      store.dispatch(setHasEthProperty(true));
      const background = saveMainState();
      if (succeeds) storage.resolve();
      else storage.reject(new Error('Storage unavailable'));
      await completion;
      await expect(background).resolves.toBe(true);
      const expected = succeeds ? 10 : 5;
      expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(
        expected
      );
      expect(disk.vaultGlobal.advancedSettings.autolock).toBe(expected);
      expect(disk.vaultGlobal.hasEthProperty).toBe(true);
      expect(store.getState().vaultGlobal.hasEthProperty).toBe(true);
      expect(writes).toHaveBeenCalledTimes(2);
    }
  );

  it('repairs a completed write invalidated by reset before a queued save can observe it', async () => {
    const storage = deferred();
    let current = true;
    writes.mockImplementationOnce(async (_key, state) => {
      await storage.promise;
      disk = structuredClone(state);
    });
    const setting = persistAdvancedSetting('autolock', 10, () => current);
    const rejected = expect(setting).rejects.toThrow('Wallet state changed');
    await flush();
    current = false;
    store.dispatch(
      setAdvancedSettings({ advancedProperty: 'autolock', value: 0 })
    );
    const background = saveMainState();
    storage.resolve();
    await rejected;
    await background;
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(0);
    expect(disk.vaultGlobal.advancedSettings.autolock).toBe(0);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale queued setting before reading or writing its replacement wallet', async () => {
    await expect(
      persistAdvancedSetting('autolock', 10, () => false)
    ).rejects.toThrow('Wallet state changed');
    expect(writes).not.toHaveBeenCalled();
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(5);
  });

  it('keeps a recovery-blocked write unpublished without overwriting the recovery snapshot', async () => {
    const storage = deferred();
    writes.mockImplementationOnce(async (_key, state) => {
      await storage.promise;
      disk = structuredClone(state);
    });
    const setting = persistAdvancedSetting('autolock', 10, () => true);
    const rejected = expect(setting).rejects.toThrow('Wallet recovery');
    await flush();
    walletPersistenceGate.blocked = true;
    storage.resolve();
    await rejected;
    expect(store.getState().vaultGlobal.advancedSettings.autolock).toBe(5);
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
