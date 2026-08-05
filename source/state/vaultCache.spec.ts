import { INetworkType } from 'types/network';

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
});
