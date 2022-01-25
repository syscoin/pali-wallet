import {
  listNewDapp,
  unlistDapp,
  registerListeningSite as registerListeningSiteAction,
  deregisterListeningSite as deregisterListeningSiteAction,
} from 'state/dapp';
import { IDAppInfo, IDAppState } from 'state/dapp/types';
import store from 'state/store';

export interface IDAppController {
  deregisterListeningSite: (origin: string, eventName: string) => void;
  fromPageConnectDApp: (origin: string, title: string) => boolean;
  fromUseDisconnectDApp: (origin: string) => void;
  fromUserConnectDApp: (
    origin: string,
    dapp: IDAppInfo,
    network: string,
    accounts: string[]
  ) => void;
  getCurrent: () => IDAppInfo;
  getSigRequest: () => ISigRequest;
  isDAppConnected: (origin: string) => boolean;
  isSiteListening: (origin: string, eventName: string) => boolean;
  registerListeningSite: (origin: string, eventName: string) => void;
  setSigRequest: (req: ISigRequest) => void;
}

interface ISigRequest {
  address: string;
  message: string;
  origin: string;
}

const DAppController = (): IDAppController => {
  let current: IDAppInfo = { origin: '', title: '' };
  let request: ISigRequest;

  const isDAppConnected = (origin: string) => {
    const { trustedApps } = store.getState().dapp;

    return !!trustedApps[origin as keyof IDAppState];
  };

  const fromPageConnectDApp = (origin: string, title: string) => {
    current = {
      origin,
      logo: `chrome://favicon/size/64@1x/${origin}`,
      title,
    };

    return isDAppConnected(origin);
  };

  const fromUserConnectDApp = (
    origin: string,
    dapp: IDAppInfo,
    network: string
  ) => {
    store.dispatch(listNewDapp({ id: origin, dapp, network }));
  };

  const fromUseDisconnectDApp = (origin: string) => {
    store.dispatch(unlistDapp({ id: origin }));
  };

  const registerListeningSite = (origin: string, eventName: string) => {
    store.dispatch(registerListeningSiteAction({ origin, eventName }));
  };

  const deregisterListeningSite = (origin: string, eventName: string) => {
    store.dispatch(deregisterListeningSiteAction({ origin, eventName }));
  };

  const isSiteListening = (origin: string, eventName: string) => {
    const { listening } = store.getState().dapp;

    return listening[origin] && listening[origin].includes(eventName);
  };

  const getCurrent = () => current;

  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  return {
    getCurrent,
    fromPageConnectDApp,
    fromUserConnectDApp,
    setSigRequest,
    getSigRequest,
    fromUseDisconnectDApp,
    registerListeningSite,
    deregisterListeningSite,
    isSiteListening,
    isDAppConnected,
  };
};

export default DAppController;
