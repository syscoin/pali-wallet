import { reload } from 'utils/browser';
import { SYSCOIN_MAINNET_NETWORK_57 } from 'utils/constants';
import { saveState } from 'utils/localStorage';

const updateVaultState = async (oldState) => {
  try {
    const newState = { ...oldState };
    console.log(newState, `newState`);
    if (!newState.activeNetwork) {
      newState.activeNetwork = SYSCOIN_MAINNET_NETWORK_57;
    } else {
      newState.activeNetwork = SYSCOIN_MAINNET_NETWORK_57;
    }
    console.log(newState, `pos`);

    await saveState(newState);
    //reload()
    console.log('Vault state updated successfully!');
  } catch (error) {
    console.error('Error updating vault state', error);
  }
};

export default updateVaultState;
