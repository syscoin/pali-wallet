/* eslint-disable camelcase */

import { saveState, setMigratedVersions } from 'state/paliStorage';
import { initialState as initialVaultState } from 'state/vault';
import { IVaultState } from 'state/vault/types';

type V3_3_2 = {
  vault: IVaultState;
};

const MigrateRunner = async (oldState: any) => {
  try {
    const newState: V3_3_2 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        prevBalances: initialVaultState.prevBalances,
      },
    };

    await Promise.all([saveState(newState), setMigratedVersions('3.3.2')]);

    console.log('Migrate to <v3.3.2> successfully!');
  } catch (error) {
    console.log('<v3.3.2> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
