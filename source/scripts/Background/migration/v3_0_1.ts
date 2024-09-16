/* eslint-disable camelcase */

import { saveState } from 'state/paliStorage';
import { IVaultState } from 'state/vault/types';
import { reload } from 'utils/browser';

type V3_0_1ActiveNetworkState = {
  vault: IVaultState;
};

const MigrateRunner = async (oldState: any) => {
  try {
    const newState: V3_0_1ActiveNetworkState = {
      ...oldState,
      vault: {
        ...oldState.vault,
        version: '3.0.1',
      },
    };
    await saveState(newState);
    console.log('Migrate to <v3.0.1> successfully!');
    reload();
  } catch (error) {
    console.log('<v3.0.1> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
