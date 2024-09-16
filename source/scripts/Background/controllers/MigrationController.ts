/* eslint-disable camelcase */
import v3_0_1 from '../migration/v3_0_1';
import { loadState } from 'state/paliStorage';

const MigrationController = async () => {
  const state = await loadState(); // get state from Storage API

  /**
   * version < 3.0.1
   * Description: Adds version to vault state
   */
  if (!state.vault?.version) {
    await v3_0_1(state);
  }
};

export default MigrationController;
