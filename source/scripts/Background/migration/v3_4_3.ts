/* eslint-disable camelcase */

import { saveState, setMigratedVersions } from 'state/paliStorage';
import { IVaultState } from 'state/vault/types';

type V3_4_3 = {
  vault: IVaultState;
};

const MigrateRunner = async (oldState: any) => {
  try {
    // Remove the 80001 network from the user's state
    const newState: V3_4_3 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        timer: undefined,
        isTimerEnabled: undefined,
      },
    };

    await Promise.all([saveState(newState), setMigratedVersions('3.4.3')]);

    console.log('Migrate to <v3.4.3> successfully!');
  } catch (error) {
    console.log('<v3.4.3> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
