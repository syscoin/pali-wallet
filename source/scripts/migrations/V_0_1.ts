import { SYSCOIN_MAINNET_NETWORK_57 } from 'utils/constants';

const updateActiveNetworkVaultState = async (oldVaultState) => {
  try {
    const newVaultState = { ...oldVaultState };
    if (!newVaultState.activeNetwork) {
      newVaultState.activeNetwork = SYSCOIN_MAINNET_NETWORK_57;
    }
    return newVaultState;
  } catch (error) {
    console.error('Error updating vault state', error);
    return oldVaultState;
  }
};

export default updateActiveNetworkVaultState;
