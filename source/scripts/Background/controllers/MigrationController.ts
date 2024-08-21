import V2_0_23_MigrationState from 'scripts/migrations/V2_0_23';
import { reload } from 'utils/browser';
import { loadState, saveState } from 'utils/localStorage';

const MigrationController = async () => {
  const state: any = await loadState();

  if (!state) {
    return;
  }

  if (state.vault && !state?.vault?.faucet) {
    console.warn('<!> Migration needed <!>');
    const updatedVault = await V2_0_23_MigrationState(state.vault);
    state.vault = updatedVault;
    await saveState(state);
    reload();
  }
};

export default MigrationController;
