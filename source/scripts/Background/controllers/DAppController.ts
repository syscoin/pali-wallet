import { browser } from 'webextension-polyfill-ts';

import {
  addDApp as addDAppAction,
  removeDApp,
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

  const hasDApp = (origin: string) => {
    const { dapps } = store.getState().dapp;

    return !!dapps[origin];
  };

  const isConnected = (origin: string) => {
    const dapp = store.getState().dapp.dapps[origin];

    if (!dapp) return false;

    return dapp.accountId !== null;
  };

  const addDApp = (origin: string, title: string) => {
    store.dispatch(addDAppAction({ origin, title, accountId: null }));
  };

  const connect = (origin: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ origin, accountId }));

    _dispatchEvents([new CustomEvent('connect', { detail: { origin } })]);
  };

  const changeAccount = (origin: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ origin, accountId }));

    _dispatchEvents([new CustomEvent('accountChange', { detail: { origin } })]);
  };

  const _dispatchEvents = async (events: Event[]) => {
    const background = await browser.runtime.getBackgroundPage();

    events.forEach((event) => background.dispatchEvent(event));
  };

  const disconnect = (origin: string) => {
    store.dispatch(removeDApp(origin));

    _dispatchEvents([new CustomEvent('disconnect', { detail: { origin } })]);
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
