export const saveState = (appState: any) => {
  try {
    const serializedState = JSON.stringify(appState);

    localStorage.setItem('state', serializedState);
  } catch (error) {
    console.error('<!> Error saving state', error);
  }
};

export const loadState = () => {
  try {
    const serializedState = localStorage.getItem('state');

    if (serializedState === null) {
      return undefined;
    }

    return JSON.parse(serializedState);
  } catch (error) {
    console.error('<!> Error getting state', error);

    return null;
  }
};