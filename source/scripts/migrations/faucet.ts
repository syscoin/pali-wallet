import { reload } from 'utils/browser';
import { saveState } from 'utils/localStorage';

const updateVaultState = async (oldState) => {
  try {
    const newState = { ...oldState };
    console.log(newState, `newState`);
    if (!newState.faucetModal) {
      newState.faucetModal = {
        57: true,
        570: true,
        5700: true,
        57000: true,
      };
    } else {
      newState.faucetModal = {
        ...newState.faucetModal,
        57: true,
        570: true,
        5700: true,
        57000: true,
      };
    }
    console.log(newState, `pos`);

    await saveState(newState);
    console.log('Vault state updated successfully!');
  } catch (error) {
    console.error('Error updating vault state', error);
  }
};

export default updateVaultState;
