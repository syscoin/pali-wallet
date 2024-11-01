/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import v3_0_1 from '../migration/v3_0_1';
import v3_0_2 from '../migration/v3_0_2';
import { getIsMigratedVersion, loadState } from 'state/paliStorage';

const MigrationController = async () => {
  const state = await loadState(); // get state from Storage API
  const currentPaliVersion = paliData.version;

  if (!state) {
    console.warn('<MigrationController> No state found in chrome storage');
    return;
  }

  const isMigratedVersion = await getIsMigratedVersion(currentPaliVersion);

  /**
   * version < 3.0.1
   * Description: add faucet feature
   */
  if (currentPaliVersion === '3.0.1' && !isMigratedVersion) {
    await v3_0_1(state);
  }

  /**
   * version < 3.0.2
   * Description: add side panel feature
   */
  if (currentPaliVersion === '3.0.2' && !isMigratedVersion) {
    await v3_0_2(state);
  }
};

export default MigrationController;
