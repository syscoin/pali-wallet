const storageGetMock = jest.fn<Promise<any>, any[]>(async () => null);
const storageSetMock = jest.fn();

jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => storageGetMock(...args),
    setItem: (...args: any[]) => storageSetMock(...args),
  },
}));

import { INetworkType, KeyringAccountType } from 'types/network';

import { addDApp, removeDApp, rehydrate } from './dapp';
import { walletPersistenceGate } from './paliStorage';
import store, {
  persistDappPermissionGrant,
  persistMainStateStrict,
  saveMainState,
} from './store';
import { setHasEthProperty } from './vaultGlobal';

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

describe('staged permission grant persistence', () => {
  const host = 'https://staged-grant.invalid';
  const grant = (accountId = 1) => ({
    host,
    accountId,
    accountType: KeyringAccountType.HDAccount,
    chain: INetworkType.Ethereum,
    chainId: 1,
    date: accountId,
  });
  let disk: any;
  const clone = (value: any) => JSON.parse(JSON.stringify(value));
  const holdWrite = () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    storageSetMock.mockImplementationOnce(async (_key, value) => {
      const snapshot = clone(value);
      await pending;
      disk = snapshot;
    });
    return finish;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    walletPersistenceGate.blocked = false;
    store.dispatch(rehydrate({ dapps: {} }));
    disk = { dapp: { dapps: {} } };
    storageSetMock.mockImplementation(async (_key, value) => {
      disk = clone(value);
    });
  });
  afterEach(() => {
    walletPersistenceGate.blocked = false;
  });

  it('keeps a new grant outside Redux until it is durable and restores it after restart', async () => {
    const finish = holdWrite();
    const target = grant();
    const request = persistDappPermissionGrant(target, undefined, () => true);
    await new Promise(setImmediate);
    expect(store.getState().dapp.dapps[host]).toBeUndefined();
    finish();
    await request;
    expect(disk.dapp.dapps[host]).toEqual(target);
    expect(store.getState().dapp.dapps[host]).toEqual(target);
    store.dispatch(rehydrate(clone(disk.dapp)));
    expect(store.getState().dapp.dapps[host]).toEqual(target);
  });

  it('leaves the existing permission untouched on failure and retries durably', async () => {
    const previous = grant(0);
    store.dispatch(addDApp(previous));
    disk.dapp.dapps[host] = clone(previous);
    storageSetMock.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(
      persistDappPermissionGrant(grant(), previous, () => true)
    ).rejects.toThrow('Storage unavailable');
    expect(store.getState().dapp.dapps[host]).toBe(previous);
    expect(disk.dapp.dapps[host]).toEqual(previous);
    await persistDappPermissionGrant(grant(), previous, () => true);
    expect(disk.dapp.dapps[host]).toEqual(grant());
  });

  it.each(['replace', 'revoke', 'cancel'])(
    'repairs disk and never publishes after %s during the write',
    async (change) => {
      const previous = grant(0);
      store.dispatch(addDApp(previous));
      const finish = holdWrite();
      let current = true;
      const request = persistDappPermissionGrant(
        grant(),
        previous,
        () => current
      );
      const rejected = expect(request).rejects.toThrow('context changed');
      await new Promise(setImmediate);
      if (change === 'replace') store.dispatch(addDApp(grant(2)));
      if (change === 'revoke') store.dispatch(removeDApp(host));
      if (change === 'cancel') current = false;
      finish();
      await rejected;
      expect(storageSetMock).toHaveBeenCalledTimes(2);
      expect(disk.dapp).toEqual(store.getState().dapp);
      expect(store.getState().dapp.dapps[host]).not.toEqual(grant());
    }
  );

  it('repairs an absent-prior grant canceled while writing', async () => {
    const finish = holdWrite();
    let current = true;
    const request = persistDappPermissionGrant(
      grant(),
      undefined,
      () => current
    );
    const rejected = expect(request).rejects.toThrow('context changed');
    await new Promise(setImmediate);
    current = false;
    finish();
    await rejected;
    expect(disk.dapp.dapps[host]).toBeUndefined();
    expect(store.getState().dapp.dapps[host]).toBeUndefined();
  });

  it('pins retired absence at admission even if the exact old grant returns during writing', async () => {
    const previous = grant(0);
    const finish = holdWrite();
    const request = persistDappPermissionGrant(
      grant(),
      previous,
      () => true,
      () => grant(2),
      () => true
    );
    const rejected = expect(request).rejects.toThrow('context changed');
    await new Promise(setImmediate);
    store.dispatch(addDApp(previous));
    finish();
    await rejected;
    expect(store.getState().dapp.dapps[host]).toBe(previous);
    expect(disk.dapp.dapps[host]).toEqual(previous);
    expect(storageSetMock).toHaveBeenCalledTimes(2);
  });

  it('does not publish or repair after recovery blocks persistence during a write', async () => {
    const finish = holdWrite();
    const request = persistDappPermissionGrant(grant(), undefined, () => true);
    const rejected = expect(request).rejects.toThrow('Wallet recovery');
    await new Promise(setImmediate);
    walletPersistenceGate.blocked = true;
    finish();
    await rejected;
    expect(storageSetMock).toHaveBeenCalledTimes(1);
    expect(store.getState().dapp.dapps[host]).toBeUndefined();
  });

  it('does not overwrite newer same-host state with a queued stale grant', async () => {
    const finish = holdWrite();
    const first = persistDappPermissionGrant(grant(), undefined, () => true);
    const second = persistDappPermissionGrant(grant(2), undefined, () => true);
    const rejected = expect(second).rejects.toThrow('context changed');
    finish();
    await first;
    await rejected;
    expect(storageSetMock).toHaveBeenCalledTimes(1);
    expect(disk.dapp.dapps[host]).toEqual(grant());
  });

  it('preserves unrelated Redux updates and keeps the actual written snapshot dirty', async () => {
    const original = store.getState().vaultGlobal.hasEthProperty;
    const finish = holdWrite();
    const request = persistDappPermissionGrant(grant(), undefined, () => true);
    await new Promise(setImmediate);
    store.dispatch(setHasEthProperty(!original));
    finish();
    await request;
    expect(store.getState().vaultGlobal.hasEthProperty).toBe(!original);
    expect(disk.vaultGlobal.hasEthProperty).toBe(original);
    await expect(saveMainState()).resolves.toBe(true);
    expect(disk.vaultGlobal.hasEthProperty).toBe(!original);
  });
});
