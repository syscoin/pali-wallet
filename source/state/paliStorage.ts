import { chromeStorage } from 'utils/storageAPI';

export const saveState = async (appState: any) => {
  try {
    const serializedState = JSON.stringify(appState);
    await chromeStorage.setItem('state', serializedState);
  } catch (e) {
    console.error('<!> Error saving state', e);
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
