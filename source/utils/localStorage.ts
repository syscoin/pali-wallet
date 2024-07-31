import store from 'state/store';

export const saveState = async (appState) => {
  try {
    const serializedState = JSON.stringify(appState);
    await localStorage.setItem('persist:root', serializedState);
    console.log('State saved successfully!');
  } catch (e) {
    console.error('<!> Error saving state', e);
  }
};

export const loadState = async () => {
  try {
    const state = store.getState();

    if (state === null) {
      return undefined;
    }
    return state;
  } catch (e) {
    console.error('<!> Error getting state', e);
    return null;
  }
};
