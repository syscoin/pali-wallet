import _ from 'lodash';
import { Runtime } from 'webextension-polyfill-ts';

import { addDApp, removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { setActiveNetwork } from 'state/vault';
import { IOmittedVault } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';

import { onDisconnect, onMessage } from './message-handler';
import { DAppEvents } from './message-handler/types';

interface IDappsSession {
  [host: string]: {
    activeAddress: string | null;
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

  const isConnected = (host: string) => Boolean(_dapps[host].activeAddress);

  const setup = (port: Runtime.Port) => {
    const { host } = new URL(port.sender.url);
    const activeAccount = getAccount(host)?.address;
    console.log('Checking host on setup', host);
    _dapps[host] = {
      activeAddress: activeAccount ? activeAccount : null,
      hasWindow: false,
      listens: [],
      port,
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };

  const connect = (dapp: IDApp, isDappConnected = false) => {
    !isDappConnected && store.dispatch(addDApp(dapp));
    const { accounts } = store.getState().vault;
    _dapps[dapp.host].activeAddress = accounts[dapp.accountId].address;
    //TODO: check further connect function, ethereum EIP1193 asks only to dispatch connect event when provider becomes available not when wallet connects to dapp
    // _dispatchEvent(dapp.host, DAppEvents.connect, {
    //   connectedAccount: getAccount(dapp.host),
    // });
  };

  const requestPermissions = (host: string, accountId: number) => {
    const date = Date.now();

    store.dispatch(updateDAppAccount({ host, accountId, date }));

    const { accounts } = store.getState().vault;
    const account = accounts[accountId];

    if (!account) return null;
    const response: any = [{}];
    response[0].caveats = [
      { type: 'restrictReturnedAccounts', value: [account] },
    ];

    response[0].date = date;
    response[0].invoker = host;
    response[0].parentCapability = 'eth_accounts';

    _dapps[host].activeAddress = account.address;
    _dispatchEvent(host, 'requestPermissions', response);
    _dispatchEvent(host, DAppEvents.accountsChanged, [account.address]);
  };

  const changeAccount = (host: string, accountId: number) => {
    const date = Date.now();
    const { accounts, isBitcoinBased } = store.getState().vault;
    store.dispatch(updateDAppAccount({ host, accountId, date }));
    _dapps[host].activeAddress = accounts[accountId].address;
    isBitcoinBased
      ? _dispatchEvent(
          host,
          DAppEvents.accountsChanged,
          removeXprv(accounts[accountId])
        )
      : _dispatchEvent(host, DAppEvents.accountsChanged, [
          _dapps[host].activeAddress,
        ]);
  };

  const disconnect = (host: string) => {
    // after disconnecting, the event would not be sent
    _dapps[host].activeAddress = null;
    _dispatchEvent(host, 'accountsChanged', [_dapps[host].activeAddress]);

    store.dispatch(removeDApp(host));
  };

  const changeNetwork = (chainId: number) => {
    const { isBitcoinBased, networks } = store.getState().vault;
    const network = isBitcoinBased
      ? networks.syscoin[chainId]
      : networks.ethereum[chainId];

    store.dispatch(setActiveNetwork(network));

    dispatchEvent(DAppEvents.chainChanged, chainId);
  };

  //* ----- Event listeners -----
  const addListener = (host: string, eventName: string) => {
    if (!DAppEvents[eventName]) return;
    console.log('Trying to add event to dapp', host, eventName);
    if (_dapps[host].listens.includes(eventName)) return;
    _dapps[host].listens.push(eventName);
    console.log('Event added', _dapps[host]);
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
    if (data?.lockState === '2') {
      const dapps = Object.values(store.getState().dapp.dapps);
      for (const dapp of dapps) {
        console.error('Checking event emision on unlock', dapp.host, event, [
          _dapps[dapp.host].activeAddress,
        ]);
        _dispatchEvent(dapp.host, event, [_dapps[dapp.host].activeAddress]);
      }
      return;
    } else if (data?.lockState === '1') {
      const dapps = Object.values(store.getState().dapp.dapps);
      for (const dapp of dapps) {
        console.error('Checking event emision on lock', dapp.host, event, []);
        _dispatchEvent(dapp.host, event, []);
      }
      return;
    }
    // const dapps = Object.values(store.getState().dapp.dapps);
    // const dapps =
    const hosts = Object.keys(_dapps);
    for (const host of hosts) {
      console.log('Iterating over host', event, data);
      _dispatchEvent(host, event, data);
    }
  };

  const _dispatchEvent = async (
    host: string,
    eventName: string,
    data?: any
  ) => {
    // dispatch the event locally
    const { isBitcoinBased } = store.getState().vault;
    const event = new CustomEvent(`${eventName}.${host}`, { detail: data });
    console.log('Checking event', eventName, host, isBitcoinBased, data);
    window.dispatchEvent(event); // Why adding this dispatch of event by window here ?
    // if (!hasListener(host, eventName)) return; //TODO: fix event bugs
    // if (!isConnected(host) && isBitcoinBased) return;

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
    if (!dapp) return null;
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
    requestPermissions,
    removeListener,
    removeListeners,
    dispatchEvent,
    hasListener,
    hasWindow,
    getState,
    getNetwork,
    setHasWindow,
    changeNetwork,
  };
};

export default DAppController;
