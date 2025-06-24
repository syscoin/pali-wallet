import { chromeStorage } from 'utils/storageAPI';

export const saveState = async (appState: any) => {
  try {
    const serializedState = JSON.stringify(appState);
    await chromeStorage.setItem('state', serializedState);
  } catch (e) {
    console.error('<!> Error saving state', e);
  }
};

export const saveSlip44State = async (slip44: number, vaultState: any) => {
  try {
    const serializedState = JSON.stringify(vaultState);
    await chromeStorage.setItem(`state-vault-${slip44}`, serializedState);
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
    return JSON.parse(serializedState);
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
      const parsedState = JSON.parse(serializedState);
      return parsedState;
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

export const loadAllSlip44States = async () => {
  try {
    const allItems = await new Promise<{ [key: string]: any }>((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(items);
      });
    });

    const slip44States: { [slip44: number]: any } = {};

    Object.keys(allItems).forEach((key) => {
      const match = key.match(/^state-vault-(\d+)$/);
      if (match) {
        const slip44 = parseInt(match[1], 10);
        try {
          slip44States[slip44] = JSON.parse(allItems[key]);
        } catch (e) {
          console.error(`Failed to parse state for slip44 ${slip44}`, e);
        }
      }
    });

    return slip44States;
  } catch (e) {
    console.error('<!> Error loading all slip44 states', e);
    return {};
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
