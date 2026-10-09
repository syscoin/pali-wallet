import { INetworkType } from 'types/network';
import { walletPersistenceMutex } from 'utils/asyncMutex';

import { loadSlip44State, saveSlip44State } from './paliStorage';
import type { ISlip44State } from './vault/types';
import vaultCache from './vaultCache';

jest.mock('./paliStorage', () => ({
  ...jest.requireActual('./paliStorage'),
  loadSlip44State: jest.fn(),
  saveSlip44State: jest.fn(),
}));

describe('VaultCache', () => {
  beforeEach(() => {
    vaultCache.clearCache();
    jest.mocked(loadSlip44State).mockReset().mockResolvedValue(null);
    jest.mocked(saveSlip44State).mockReset().mockResolvedValue(undefined);
  });

  it('publishes a queued vault snapshot to the cache synchronously', async () => {
    const vaultState = {
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
      },
    } as ISlip44State;

    const savePromise = vaultCache.setSlip44Vault(60, vaultState);

    await expect(vaultCache.getSlip44Vault(60)).resolves.toEqual(vaultState);
    expect(loadSlip44State).not.toHaveBeenCalled();

    await savePromise;
    expect(saveSlip44State).toHaveBeenCalledWith(60, vaultState);
  });

  it('does not repopulate a cleared cache from a delayed old-wallet read', async () => {
    let complete!: (value: any) => void;
    jest.mocked(loadSlip44State).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const loading = vaultCache.getSlip44Vault(60);
    const rejected = expect(loading).rejects.toThrow('Wallet state changed');
    vaultCache.clearCache();
    complete({ activeNetwork: { kind: INetworkType.Ethereum, slip44: 60 } });
    await rejected;
    expect(vaultCache.isVaultCached(60)).toBe(false);
    await expect(vaultCache.getSlip44Vault(60)).resolves.toBeNull();
  });

  it('does not write an old source snapshot queued before wallet reset', async () => {
    let release!: () => void;
    const occupied = walletPersistenceMutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await Promise.resolve();
    let walletGeneration = 0;
    const source = {
      activeNetwork: { kind: INetworkType.Ethereum, slip44: 60 },
    } as ISlip44State;
    const saving = vaultCache.setSlip44Vault(
      60,
      source,
      () => walletGeneration === 0
    );
    const rejected = expect(saving).rejects.toThrow('Wallet state changed');
    walletGeneration += 1;
    vaultCache.clearCache();
    release();
    await occupied;
    await rejected;
    expect(saveSlip44State).not.toHaveBeenCalled();
    expect(vaultCache.isVaultCached(60)).toBe(false);
  });

  it('preserves a queued source snapshot across ordinary lock/cache clearing', async () => {
    let release!: () => void;
    const occupied = walletPersistenceMutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await Promise.resolve();
    const source = {
      activeNetwork: { kind: INetworkType.Ethereum, slip44: 60 },
    } as ISlip44State;
    const saving = vaultCache.setSlip44Vault(60, source, () => true);
    vaultCache.clearCache();
    release();
    await occupied;
    await saving;
    expect(saveSlip44State).toHaveBeenCalledWith(60, source);
  });
});
