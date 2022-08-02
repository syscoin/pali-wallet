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

import { onDisconnect, onMessage } from './message-handler';
import { DAppEvents } from './message-handler/types';

export interface ISigRequest {
  address: string;
  host: string;
  message: string;
}

interface IDappUtils {
  [host: string]: {
    hasWindow: boolean;
    port: Runtime.Port;
  };
}

/**
 * Controls the dapp store
 *
 * DApps connections use the site host as id
 */
const DAppController = (): IDAppController => {
  let request: ISigRequest;

  const _dapps: IDappUtils = {};

  const hasDApp = (host: string) => {
    const { dapps } = store.getState().dapp;

    return !!dapps[host];
  };

  const isConnected = (host: string) => {
    const dapp = store.getState().dapp.dapps[host];

    if (!dapp) return false;

    return dapp.accountId !== null;
  };

  const addDApp = (port: Runtime.Port) => {
    const { host } = new URL(port.sender.url);
    const title = port.sender.tab.title;

    _dapps[host] = { port, hasWindow: false };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    store.dispatch(addDAppAction({ host, title, accountId: null }));
  };

  const removeDApp = (host: string) => {
    store.dispatch(removeDAppAction(host));
  };

  const connect = (host: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ host, accountId }));

    _dispatchEvent(host, 'connect');
  };

  const changeAccount = (host: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ host, accountId }));

    _dispatchEvent(host, 'accountChange');
  };

  const disconnect = (host: string) => {
    // after disconnecting, the event would not be sent
    _dispatchEvent(host, 'disconnect');

    store.dispatch(updateDAppAccount({ host, accountId: null }));
  };

  const _dispatchEvent = async (
    host: string,
    eventName: string,
    data?: any
  ) => {
    if (!hasListener(host, eventName)) return;
    if (!isConnected(host)) return;

    // dispatch the event locally
    const event = new CustomEvent(eventName, { detail: { host, data } });
    window.dispatchEvent(event);

    // post the event to the DApp
    const id = `${host}.${eventName}`;
    _dapps[host].port.postMessage({ id, data });
  };

  const addListener = (host: string, eventName: string) => {
    if (!DAppEvents[eventName]) return;

    store.dispatch(addListenerAction({ host, eventName }));
  };

  const removeListener = (host: string, eventName: string) => {
    if (!DAppEvents[eventName]) return;

    store.dispatch(removeListenerAction({ host, eventName }));
  };

  const removeListeners = (host: string) => {
    store.dispatch(removeListenersAction(host));
  };

  const hasListener = (host: string, eventName: string) => {
    const { dapp } = store.getState();

    return dapp.listeners[host] && dapp.listeners[host].includes(eventName);
  };

  const getDApp = (host: string) => store.getState().dapp.dapps[host];

  const getAccount = (host: string) => {
    const dapp = store.getState().dapp.dapps[host];
    const { accounts } = store.getState().vault;

    if (dapp?.accountId === null) return;

    return accounts[dapp.accountId];
  };

  // TODO review sig request
  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  const hasWindow = (host: string) => _dapps[host].hasWindow;

  const setHasWindow = (host: string, has: boolean) => {
    _dapps[host].hasWindow = has;
  };

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
    hasWindow,
    setHasWindow,
  };
};

export default DAppController;