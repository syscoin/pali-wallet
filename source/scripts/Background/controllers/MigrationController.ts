/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import v3_0_1 from '../migration/v3_0_1';
import { loadState } from 'state/paliStorage';

const MigrationController = async () => {
  const state = await loadState(); // get state from Storage API
  const currentPaliVersion = paliData.version;

  /**
   * version < 3.0.1
   * Description: Example of migration from version 3.0.0 to 3.0.1
   */
  if (currentPaliVersion === '3.0.1') {
    await v3_0_1(state);
  }
};

export default MigrationController;
