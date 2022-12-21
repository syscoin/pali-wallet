import _ from 'lodash';
import { Runtime } from 'webextension-polyfill-ts';

import { addDApp, removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { IOmittedVault } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';

import { onDisconnect, onMessage } from './message-handler';
import { DAppEvents, PaliEvents } from './message-handler/types';

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
    // _dispatchEvent(host, DAppEvents.accountsChanged, [account.address]);
    _dispatchPaliEvent(
      host,
      {
        method: PaliEvents.accountsChanged,
        params: [_dapps[host].activeAddress],
      },
      PaliEvents.accountsChanged
    );
  };

  const changeAccount = (host: string, accountId: number) => {
    const date = Date.now();
    // const { accounts, isBitcoinBased } = store.getState().vault;
    const { accounts } = store.getState().vault;
    store.dispatch(updateDAppAccount({ host, accountId, date }));
    _dapps[host].activeAddress = accounts[accountId].address;
    _dispatchPaliEvent(
      host,
      {
        method: PaliEvents.accountsChanged,
        params: [_dapps[host].activeAddress],
      },
      PaliEvents.accountsChanged
    );
    // isBitcoinBased
    //   ? _dispatchEvent(
    //       host,
    //       DAppEvents.accountsChanged,
    //       removeXprv(accounts[accountId])
    //     )
    //   : _dispatchEvent(host, DAppEvents.accountsChanged, [
    //       _dapps[host].activeAddress,
    //     ]);
  };

  const disconnect = (host: string) => {
    _dapps[host].activeAddress = null;
    // _dispatchEvent(host, 'accountsChanged', [_dapps[host].activeAddress]);
    console.log(
      'Disconnecting dapp from pali',
      host,
      _dapps[host].activeAddress,
      PaliEvents.accountsChanged
    );
    store.dispatch(removeDApp(host));
    _dispatchPaliEvent(
      host,
      {
        method: PaliEvents.accountsChanged,
        params: [],
      },
      PaliEvents.accountsChanged
    );
    return [] as string[];
  };

  const handleStateChange = async (
    id: PaliEvents,
    data: { method: string; params: any }
  ): Promise<void> => {
    new Promise<void>((resolve, reject) => {
      try {
        const dapps = Object.values(store.getState().dapp.dapps);
        for (const dapp of dapps) {
          if (id === PaliEvents.lockStateChanged && _dapps[dapp.host]) {
            console.log(
              'Checking dapps connections',
              _dapps[dapp.host],
              dapp.host
            );
            data.params.accounts = data.params.isUnlocked
              ? [_dapps[dapp.host].activeAddress]
              : [];
          }
          _dispatchPaliEvent(dapp.host, data, id);
        }
        resolve();
      } catch (error) {
        reject(`Error: ${error}`);
      }
    });
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

  const _dispatchPaliEvent = async (
    host: string,
    data?: { method: string; params: any },
    id = 'notification'
  ) => {
    if (_dapps[host] && _dapps[host].port) {
      _dapps[host].port.postMessage({ id, data });
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
    handleStateChange,
    getState,
    getNetwork,
    setHasWindow,
  };
};

export default DAppController;
