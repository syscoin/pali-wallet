import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { addDApp, removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { IOmittedVault } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';

import { onMessage } from './message-handler';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

interface IDappsSession {
  [host: string]: {
    activeAddress: string | null;
    hasWindow: boolean;
    port: chrome.runtime.Port;
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

    return !!dapps?.[host];
  };

  const setup = (port: chrome.runtime.Port) => {
    const { isBitcoinBased } = store.getState().vault;
    const { host } = new URL(port.sender.url);
    const activeAccount = isBitcoinBased
      ? getAccount(host)?.xpub
      : getAccount(host)?.address;
    _dapps[host] = {
      activeAddress: activeAccount ? activeAccount : null,
      hasWindow: false,
      port,
    };

    port.onMessage.addListener(onMessage);
    // port.onDisconnect.addListener(onDisconnect); //TODO: make contentScript unavailable to Dapp on disconnection of port
  };

  const connect = (dapp: IDApp, isDappConnected = false) => {
    !isDappConnected && store.dispatch(addDApp(dapp));
    const { accounts, isBitcoinBased } = store.getState().vault;
    _dapps[dapp.host] = { activeAddress: '', hasWindow: false, port: null };
    _dapps[dapp.host].activeAddress = isBitcoinBased
      ? accounts[dapp.accountType][dapp.accountId].xpub
      : accounts[dapp.accountType][dapp.accountId].address;
  };

  const requestPermissions = (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => {
    const date = Date.now();

    store.dispatch(updateDAppAccount({ host, accountId, accountType, date }));

    const { accounts } = store.getState().vault;
    const account = accounts[accountType][accountId];

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
    _dispatchPaliEvent(
      host,
      {
        method: PaliEvents.accountsChanged,
        params: [_dapps[host].activeAddress],
      },
      PaliEvents.accountsChanged
    );
  };

  const changeAccount = (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => {
    const date = Date.now();
    const { accounts, isBitcoinBased } = store.getState().vault;
    store.dispatch(updateDAppAccount({ host, accountId, date, accountType }));
    _dapps[host].activeAddress = isBitcoinBased
      ? accounts[accountType][accountId].xpub
      : accounts[accountType][accountId].address;
    isBitcoinBased
      ? _dispatchPaliEvent(
          host,
          {
            method: PaliSyscoinEvents.xpubChanged,
            params: accounts[accountType][accountId].xpub,
          },
          PaliSyscoinEvents.xpubChanged
        )
      : _dispatchPaliEvent(
          host,
          {
            method: PaliEvents.accountsChanged,
            params: [_dapps[host].activeAddress],
          },
          PaliEvents.accountsChanged
        );
  };

  const disconnect = (host: string) => {
    const previousConnectedDapps = getAll();
    const isInActiveSession = Boolean(_dapps[host]);

    switch (isInActiveSession) {
      case true:
        _dapps[host].activeAddress = null;
        store.dispatch(removeDApp(host));
        _dispatchPaliEvent(
          host,
          {
            method: PaliEvents.accountsChanged,
            params: [],
          },
          PaliEvents.accountsChanged
        );
        _dispatchPaliEvent(
          host,
          {
            method: PaliSyscoinEvents.xpubChanged,
            params: null,
          },
          PaliSyscoinEvents.xpubChanged
        );
        break;
      case false:
        if (previousConnectedDapps[host]) {
          store.dispatch(removeDApp(host));
          _dispatchPaliEvent(
            host,
            {
              method: PaliEvents.accountsChanged,
              params: [],
            },
            PaliEvents.accountsChanged
          );
          _dispatchPaliEvent(
            host,
            {
              method: PaliSyscoinEvents.xpubChanged,
              params: null,
            },
            PaliSyscoinEvents.xpubChanged
          );
        } else {
          throw new Error('DApp not connected');
        }
        break;
    }
  };
  //HandleStateChange purpose is to dispatch notifications that are meant to be globally
  //broadcasted to all Dapps on browser being them connected or not
  //The lockStateChanged and chainChanged events, that should be globally updated
  //So that's why it is fetching all hosts
  const handleStateChange = async (
    id: PaliEvents,
    data: { method: string; params: any }
  ): Promise<void> => {
    new Promise<void>((resolve, reject) => {
      try {
        const hosts = Object.keys(_dapps) as unknown as string;
        const paliData = data;
        for (const host of hosts) {
          if (id === PaliEvents.lockStateChanged && _dapps[host]) {
            paliData.method = PaliSyscoinEvents.lockStateChanged;
            delete paliData.params.accounts;
            paliData.params.xpub = data.params.isUnlocked
              ? _dapps[host].activeAddress
              : null;
            data.params.accounts = data.params.isUnlocked
              ? [_dapps[host].activeAddress]
              : [];
            _dispatchPaliEvent(host, data, PaliSyscoinEvents.lockStateChanged);
          }
          _dispatchPaliEvent(host, data, id);
        }
        resolve();
      } catch (error) {
        reject(`Error: ${error}`);
      }
    });
  };

  const handleBlockExplorerChange = async (
    id: PaliSyscoinEvents,
    data: { method: string; params: any }
  ): Promise<void> => {
    new Promise<void>((resolve) => {
      const hosts = Object.keys(_dapps) as unknown as string;
      for (const host of hosts) {
        _dispatchPaliEvent(host, data, id);
      }
      resolve();
    });
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
    const event = new CustomEvent(`${eventName}.${host}`, { detail: data });
    window.dispatchEvent(event);
  };

  //* ----- Getters/Setters -----
  const get = (host: string) => store.getState().dapp.dapps[host];

  const getAll = () => store.getState().dapp.dapps;

  const getAccount = (host: string) => {
    const dapp = store.getState().dapp.dapps[host];
    const { accounts } = store.getState().vault;
    if (!dapp) return null;
    const account = accounts[dapp.accountType][dapp.accountId];

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
    requestPermissions,
    hasWindow,
    handleStateChange,
    handleBlockExplorerChange,
    getState,
    getNetwork,
    setHasWindow,
  };
};

export default DAppController;
