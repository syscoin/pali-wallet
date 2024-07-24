import versionX_X_X from '../../migrations/faucet';
import { loadState } from 'utils/localStorage';
const MigrationController = async () => {
  // check current version of wallet
  const state = await loadState();
  console.log(`lovato 1`);
  console.log(state);

  if (!state) {
    console.log(`lovato 2`);
    return;
  }

  // if (state.vault && !state.vault?.faucetModal) {
  //   console.log('chegou');

  //   await versionX_X_X(state.vault);
  // }
};

export default MigrationController;
