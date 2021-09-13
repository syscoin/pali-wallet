import { browser } from 'webextension-polyfill-ts'

export const saveState = (appState: any) => {
  try {
    const serializedState = JSON.stringify(appState);

    browser.storage.local.set({ state: serializedState });
  } catch (error) {
    console.error('<!> Error saving state', error);
  }
};

export const loadState = () => {
  try {
    browser.storage.local.get(['state']).then((storage) => {
      if (storage.state === null) {
        return undefined;
      }

      console.log('bew',JSON.parse(JSON.stringify(storage.state)))
  
      return JSON.parse(JSON.stringify(storage.state));
    });

    
  } catch (error) {
    console.error('<!> Error getting state', error);

    return null;
  }
};
