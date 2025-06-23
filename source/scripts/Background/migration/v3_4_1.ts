/* eslint-disable camelcase */

import { saveState, setMigratedVersions } from 'state/paliStorage';
import { IVaultState } from 'state/vault/types';

type V3_4_1 = {
  vault: IVaultState;
};

const MigrateRunner = async (oldState: any) => {
  try {
    // Skip migration if vault doesn't exist (clean wallet)
    if (!oldState?.vault?.networks?.ethereum) {
      console.log(
        '<v3.4.1> Skipping migration - no vault state found (clean wallet)'
      );
      await setMigratedVersions('3.4.1');
      return;
    }

    // Remove the 80001 network from the user's state
    const newState: V3_4_1 = {
      ...oldState,
      vault: {
        ...oldState.vault,
        networks: {
          ...oldState.vault.networks,
          ethereum: {
            ...oldState.vault.networks.ethereum,
            80001: undefined,
          },
        },
      },
    };

    await Promise.all([saveState(newState), setMigratedVersions('3.4.1')]);

    console.log('Migrate to <v3.4.1> successfully!');
  } catch (error) {
    console.log('<v3.4.1> Migration Error');
    console.log(error);
  }
};

export default MigrateRunner;
