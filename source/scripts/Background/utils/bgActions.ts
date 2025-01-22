import { INetwork } from '@pollum-io/sysweb3-network';

import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

export const verifyPaliRequests = () => {
  chrome.runtime.sendMessage({
    type: 'verifyPaliRequests',
    target: 'background',
  });
};

export const removeVerifyPaliRequestListener = () => {
  chrome.runtime.sendMessage({
    type: 'removeVerifyPaliRequestListener',
    target: 'background',
  });
};

export const keepSWAlive = () => {
  chrome.runtime.sendMessage({
    type: 'ping',
    target: 'background',
  });
};

export const resetPaliRequestsCount = () => {
  chrome.runtime.sendMessage({
    type: 'resetPaliRequestsCount',
    target: 'background',
  });
};

export const dispatchChangeNetworkBgEvent = (
  network: INetwork,
  isBitcoinBased: boolean
) => {
  chrome.runtime.sendMessage({
    type: 'changeNetwork',
    target: 'background',
    data: { network, isBitcoinBased },
  });
};

export const setLanguageInLocalStorage = async (lang: PaliLanguages) => {
  try {
    const serializedState = JSON.stringify(lang);
    await chromeStorage.setItem('language', serializedState);
  } catch (e) {
    console.error('<!> Error saving language', e);
  }
};
