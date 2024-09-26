/* eslint-disable camelcase */

import { saveState } from 'state/paliStorage';
import { IVaultState } from 'state/vault/types';

type V3_0_1 = {
  vault: IVaultState;
};

const MigrateRunner = async (oldState: any) => {
  try {
    const newState: V3_0_1 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        // add new properties here
      },
    };
    await saveState(newState);
    console.log('Migrate to <v3.0.1> successfully!');
  } catch (error) {
    console.log('<v3.0.1> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
