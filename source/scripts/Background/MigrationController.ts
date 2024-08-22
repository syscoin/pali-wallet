// import { reload } from 'utils/browser';

import { loadState } from '../../state/localStorage';

const MigrationController = async () => {
  const state: any = loadState();

  if (!state) {
    return;
  }

  // if (state.vault && !state?.vault?.NEW_STATE) {
  //   console.warn('<!> Migration needed <!>');
  //   const updatedVault = await NEW_STATE_MIGRATION(state.vault);
  //   state.vault = updatedVault;
  //   await saveState(state);
  //   reload();
  // }
};

export default MigrationController;
