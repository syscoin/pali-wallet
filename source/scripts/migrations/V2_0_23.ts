const faucetMigrationState = async (oldVaultState) => {
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

export default faucetMigrationState;
