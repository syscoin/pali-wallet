import _ from 'lodash';
import { Runtime } from 'webextension-polyfill-ts';

import { addDApp, removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { IOmittedVault } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';

import { onDisconnect, onMessage } from './message-handler';
import { DAppEvents } from './message-handler/types';

interface IDappsSession {
  [host: string]: {
    hasWindow: boolean;
    listens: string[];
    port: Runtime.Port;
  };
}

/**
 * Controls the dapp store
 *
 * DApps connections use the site host as id
 */
const DAppController = (): IDAppController => {
  const _dapps: IDappsSession = {};

  const isConnected = (host: string) => {
    const { dapps } = store.getState().dapp;

    return Boolean(dapps[host]);
  };

  const setup = (port: Runtime.Port) => {
    const { host } = new URL(port.sender.url);

    _dapps[host] = {
      hasWindow: false,
      listens: [],
      port,
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };

  const connect = (dapp: IDApp) => {
    store.dispatch(addDApp(dapp));

    _dispatchEvent(dapp.host, 'connect');
  };

  const changeAccount = (host: string, accountId: number) => {
    store.dispatch(updateDAppAccount({ host, accountId }));

    _dispatchEvent(host, 'accountChange');
  };

  const disconnect = (host: string) => {
    // after disconnecting, the event would not be sent
    _dispatchEvent(host, 'disconnect');

    store.dispatch(removeDApp(host));
  };

  //* ----- Event listeners -----
  const addListener = (host: string, eventName: string) => {
    if (!DAppEvents[eventName]) return;
    if (_dapps[host].listens.includes(eventName)) return;

    _dapps[host].listens.push(eventName);
  };

  const removeListener = (host: string, eventName: string) => {
    if (!DAppEvents[eventName]) return;

    _.remove(_dapps[host].listens, (e) => e === eventName);
  };

  const removeListeners = (host: string) => {
    _dapps[host].listens = [];
  };

  const hasListener = (host: string, eventName: string) =>
    _dapps[host] && _dapps[host].listens.includes(eventName);

  const dispatchEvent = (event: DAppEvents, data: any) => {
    const dapps = Object.values(store.getState().dapp.dapps);
    for (const dapp of dapps) {
      _dispatchEvent(dapp.host, event, data);
    }
  };

  const _dispatchEvent = async (
    host: string,
    eventName: string,
    data?: any
  ) => {
    // dispatch the event locally
    const event = new CustomEvent(`${eventName}.${host}`, { detail: data });
    window.dispatchEvent(event);

    if (!hasListener(host, eventName)) return;
    if (!isConnected(host)) return;

    // post the event to the DApp
    const id = `${host}.${eventName}`;
    _dapps[host].port.postMessage({ id, data });
  };

  //* ----- Getters/Setters -----
  const get = (host: string) => store.getState().dapp.dapps[host];

  const getAll = () => store.getState().dapp.dapps;

  const getAccount = (host: string) => {
    const dapp = store.getState().dapp.dapps[host];
    const { accounts } = store.getState().vault;

    const account = accounts[dapp.accountId];

    if (!dapp || !account) return null;

    return removeXprv(account);
  };

  const getState = (): IOmittedVault =>
    removeSensitiveDataFromVault(store.getState().vault);

  const getNetwork = () => {
    const { activeNetwork, isBitcoinBased } = store.getState().vault;

    return {
      ...activeNetwork,
      isBitcoinBased,
    };
  };

  const hasWindow = (host: string) => _dapps[host].hasWindow;

  const setHasWindow = (host: string, has: boolean) => {
    _dapps[host].hasWindow = has;
  };

  return {
    get,
    getAll,
    getAccount,
    isConnected,
    setup,
    connect,
    changeAccount,
    disconnect,
    addListener,
    removeListener,
    removeListeners,
    dispatchEvent,
    hasListener,
    hasWindow,
    getState,
    getNetwork,
    setHasWindow,
  };
};

export default DAppController;
