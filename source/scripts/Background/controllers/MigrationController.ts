/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import v3_0_1 from '../migration/v3_0_1';
import v3_3_2 from '../migration/v3_3_2';
import v3_4_1 from '../migration/v3_4_1';
import v3_4_4 from '../migration/v3_5_0';
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
   * version < 3.3.2
   * Description: add faucet feature
   */
  if (currentPaliVersion === '3.3.2' && !isMigratedVersion) {
    await v3_3_2(state);
  }

  /**
   * version < 3.4.1
   * Description: remove 80001 network
   */
  if (currentPaliVersion === '3.4.1' && !isMigratedVersion) {
    await v3_4_1(state);
  }

  /**
   * version < 3.5.5
   * Description: fix networks without kind properties
   */
  if (currentPaliVersion === '3.5.0' && !isMigratedVersion) {
    await v3_4_4(state);
  }
};

export default MigrationController;
