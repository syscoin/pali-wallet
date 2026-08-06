import store, {
  loadAndActivateSlip44Vault,
  restoreSourceVaultAfterUncommittedSwitch,
} from 'state/store';
import { setNetworkChange } from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';

describe('network switch vault rollback', () => {
  it('restores the source snapshot when slip44 activation did not commit', () => {
    const sourceSlip44 = store.getState().vault.activeNetwork.slip44;
    store.dispatch(setActiveSlip44(sourceSlip44));
    const sourceVault = store.getState().vault;
    const targetNetwork = {
      ...sourceVault.activeNetwork,
      chainId: Number(sourceVault.activeNetwork.chainId) + 1,
      slip44: sourceSlip44 === 60 ? 57 : 60,
      url: 'https://uncommitted-target.example',
    };

    store.dispatch(setNetworkChange({ activeNetwork: targetNetwork }));

    expect(store.getState().vault.activeNetwork).toBe(targetNetwork);
    expect(
      restoreSourceVaultAfterUncommittedSwitch(sourceSlip44, sourceVault)
    ).toBe(true);
    expect(store.getState().vault).toBe(sourceVault);
    expect(store.getState().vaultGlobal.activeSlip44).toBe(sourceSlip44);
  });

  it('does not restore the source after target slip44 activation commits', () => {
    const sourceVault = store.getState().vault;
    const sourceSlip44 = sourceVault.activeNetwork.slip44;
    const targetSlip44 = sourceSlip44 === 60 ? 57 : 60;
    const targetNetwork = {
      ...sourceVault.activeNetwork,
      chainId: Number(sourceVault.activeNetwork.chainId) + 1,
      slip44: targetSlip44,
      url: 'https://committed-target.example',
    };

    store.dispatch(setNetworkChange({ activeNetwork: targetNetwork }));
    store.dispatch(setActiveSlip44(targetSlip44));

    expect(
      restoreSourceVaultAfterUncommittedSwitch(sourceSlip44, sourceVault)
    ).toBe(false);
    expect(store.getState().vault.activeNetwork).toBe(targetNetwork);
    expect(store.getState().vaultGlobal.activeSlip44).toBe(targetSlip44);
  });

  it('realigns active slip44 when a non-deferred vault load fails', async () => {
    const loadedVaultSlip44 = store.getState().vault.activeNetwork.slip44;
    const requestedSlip44 = loadedVaultSlip44 === 60 ? 57 : 60;
    const loadError = new Error('vault storage unavailable');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(vaultCache, 'getSlip44Vault').mockRejectedValueOnce(loadError);

    await expect(loadAndActivateSlip44Vault(requestedSlip44)).rejects.toBe(
      loadError
    );

    expect(store.getState().vault.activeNetwork.slip44).toBe(loadedVaultSlip44);
    expect(store.getState().vaultGlobal.activeSlip44).toBe(loadedVaultSlip44);
    errorSpy.mockRestore();
  });
});
