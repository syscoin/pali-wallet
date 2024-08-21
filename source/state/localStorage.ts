//todo: when we go to the mv3 just need to uncomment this -> import localStorage from 'utils/localStorage';

export const saveState = async (appState: any) => {
  try {
    const serializedState = JSON.stringify(appState);
    await localStorage.setItem('state', serializedState);
  } catch (e) {
    console.error('<!> Error saving state', e);
  }
};

export const loadState = async () => {
  try {
    const serializedState = await localStorage.getItem('state');
    if (serializedState === null) {
      return undefined;
    }
    return JSON.parse(serializedState);
  } catch (e) {
    console.error('<!> Error getting state', e);
    return null;
  }
};
