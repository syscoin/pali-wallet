import { Runtime } from 'webextension-polyfill-ts';

import {
  addDApp as addDAppAction,
  removeDApp as removeDAppAction,
  addListener as addListenerAction,
  removeListener as removeListenerAction,
  removeListeners as removeListenersAction,
  updateDAppAccount,
} from 'state/dapp';
import store from 'state/store';
import { IDAppController } from 'types/controllers';

export interface ISigRequest {
  address: string;
  message: string;
  origin: string;
}

/**
 * Controls the dapp store
 *
 * DApps connections use the site origin as id
 */
const DAppController = (): IDAppController => {
  let request: ISigRequest;

  // Map <'origin', port>
  const _ports = new Map<string, Runtime.Port>();

  const hasDApp = (origin: string) => {
    const { dapps } = store.getState().dapp;

    return !!dapps[origin];
  };

  const isConnected = (origin: string) => {
    const dapp = store.getState().dapp.dapps[origin];

    if (!dapp) return false;

    return dapp.accountId !== null;
  };

  const addDApp = (origin: string, title: string, port: Runtime.Port) => {
    _ports.set(origin, port);
    store.dispatch(addDAppAction({ origin, title, accountId: null }));
  };

  const removeDApp = (origin: string) => {
    store.dispatch(removeDAppAction(origin));
  };

  const connect = (origin: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ origin, accountId }));

    _postEvent(origin, 'connect');
  };

  const changeAccount = (origin: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ origin, accountId }));

    _postEvent(origin, 'accountChange');
  };

  const disconnect = (origin: string) => {
    store.dispatch(updateDAppAccount({ origin, accountId: null }));

    _postEvent(origin, 'disconnect');
  };

  const _postEvent = async (origin: string, eventName: string, data?: any) => {
    if (!hasListener(origin, eventName)) return;
    if (!isConnected(origin)) return;

    const id = `${origin}.${eventName}`;
    _ports.get(origin).postMessage({ id, data });
  };

  const addListener = (origin: string, eventName: string) => {
    store.dispatch(addListenerAction({ origin, eventName }));
  };

  const removeListener = (origin: string, eventName: string) => {
    store.dispatch(removeListenerAction({ origin, eventName }));
  };

  const removeListeners = (origin: string) => {
    store.dispatch(removeListenersAction(origin));
  };

  const hasListener = (origin: string, eventName: string) => {
    const { dapp } = store.getState();

    return dapp.listeners[origin] && dapp.listeners[origin].includes(eventName);
  };

  const getDApp = (origin: string) => store.getState().dapp.dapps[origin];

  const getAccount = (origin: string) => {
    const dapp = store.getState().dapp.dapps[origin];
    const { accounts } = store.getState().vault;

    if (dapp?.accountId === null) return;

    return accounts[dapp.accountId];
  };

  // TODO review sig request
  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  return {
    getDApp,
    getAccount,
    isConnected,
    addDApp,
    removeDApp,
    connect,
    changeAccount,
    setSigRequest,
    getSigRequest,
    disconnect,
    addListener,
    removeListener,
    removeListeners,
    hasListener,
    hasDApp,
  };
};

export default DAppController;
