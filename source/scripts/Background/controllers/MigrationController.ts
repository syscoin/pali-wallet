import updateActiveNetworkVaultState from '../../migrations/V_0_1';
import { reload } from 'utils/browser';
import { loadState, saveState } from 'utils/localStorage';

const MigrationController = async () => {
  // check current version of wallet
  const state = await loadState();

  if (!state) {
    return;
  }

  if (state.vault && !state.vault.activeNetwork) {
    console.log('Migration needed');
    const updatedVault = await updateActiveNetworkVaultState(state.vault);
    state.vault = updatedVault;
    await saveState(state);
    reload();
  }
};

export default MigrationController;
