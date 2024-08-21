import V2_0_23_MigrationState from 'scripts/migrations/V2_0_23';
import { loadState, saveState } from 'state/localStorage';
import { reload } from 'utils/browser';

const MigrationController = async () => {
  const state: any = loadState();

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
