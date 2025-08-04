import { chromeStorage } from 'utils/storageAPI';

export const saveState = async (appState: any) => {
  try {
    await chromeStorage.setItem('state', appState);
  } catch (e) {
    console.error('<!> Error saving state', e);
  }
};

export const saveSlip44State = async (slip44: number, vaultState: any) => {
  try {
    await chromeStorage.setItem(`state-vault-${slip44}`, vaultState);
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to save slip44 vault ${slip44}:`,
      error
    );
    throw error;
  }
};

export const loadState = async () => {
  try {
    const serializedState = await chromeStorage.getItem('state');
    if (serializedState === null) {
      return undefined;
    }
    return serializedState;
  } catch (e) {
    console.error('<!> Error getting state', e);
    return null;
  }
};

export const loadSlip44State = async (slip44: number) => {
  try {
    const serializedState = await chromeStorage.getItem(
      `state-vault-${slip44}`
    );

    if (serializedState) {
      return serializedState;
    } else {
      return null;
    }
  } catch (error) {
    console.error(
      `[PaliStorage] ❌ Failed to load slip44 vault ${slip44}:`,
      error
    );
    return null;
  }
};

export const getIsMigratedVersion = async (version: string) => {
  if (!version) {
    console.warn('getMigratedVersion ---> Invalid version');
    return;
  }

  const serializedState = await chromeStorage.getItem(version);

  return serializedState !== null;
};

export const setMigratedVersions = async (version: string) => {
  if (!version) {
    console.warn('setMigratedVersions ---> Invalid version');
    return;
  }

  try {
    await chromeStorage.setItem(version, 'migrated');
  } catch (err) {
    console.log({ err });
  }
};
