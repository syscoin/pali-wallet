const V2_0_23_MigrationState = async (oldVaultState) => {
  try {
    const newVaultState = { ...oldVaultState };

    if (!newVaultState.faucetModal) {
      newVaultState.faucetModal = {
        57: true,
        570: true,
        5700: true,
        57000: true,
      };
    } else {
      newVaultState.faucetModal = {
        ...newVaultState.faucetModal,
        57: true,
        570: true,
        5700: true,
        57000: true,
      };
    }
    console.log('Migrated was successfully done!');
    return newVaultState;
  } catch (error) {
    console.log('Migration Error');
  }
};

export default V2_0_23_MigrationState;
