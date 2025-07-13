import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';

import { notificationManager } from '../notification-manager';
import { addDApp, removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { IOmittedVault } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';

import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

interface IDappsSession {
  [host: string]: {
    activeAddress: string | null;
    hasWindow: boolean;
  };
}

/**
 * Controls the dapp store
 *
 * DApps connections use the site host as id
 */
const DAppController = (): IDAppController => {
  const _dapps: IDappsSession = {};

  // Message handler is registered in handleListeners - no need to register here
  // This prevents duplicate listener registration which causes "message port closed" errors

  const isConnected = (host: string) => {
    const { dapps } = store.getState().dapp;

    return !!dapps?.[host];
  };

  const setup = (sender: chrome.runtime.MessageSender) => {
    // Validate sender and sender.url to prevent TypeError
    if (!sender || !sender.url) {
      console.warn(
        '[DAppController] setup called with invalid sender:',
        sender
      );
      return;
    }

    try {
      const { isBitcoinBased } = store.getState().vault;
      const { host } = new URL(sender.url);
      const activeAccount = isBitcoinBased
        ? getAccount(host)?.xpub
        : getAccount(host)?.address;
      _dapps[host] = {
        activeAddress: activeAccount ? activeAccount : null,
        hasWindow: false,
      };
    } catch (error) {
      console.error(
        '[DAppController] Error in setup with sender.url:',
        sender.url,
        error
      );
    }
  };

  const connect = (dapp: IDApp, isDappConnected = false) => {
    !isDappConnected && store.dispatch(addDApp(dapp));
    const { accounts, isBitcoinBased } = store.getState().vault;
    _dapps[dapp.host] = { activeAddress: '', hasWindow: false };
    _dapps[dapp.host].activeAddress = isBitcoinBased
      ? accounts[dapp.accountType][dapp.accountId].xpub
      : accounts[dapp.accountType][dapp.accountId].address;

    // Trigger connection notification
    notificationManager.notifyDappConnection(dapp.host, true);

    isBitcoinBased
      ? _dispatchPaliEvent(
          dapp.host,
          {
            method: PaliSyscoinEvents.xpubChanged,
            params: accounts[dapp.accountType][dapp.accountId].xpub,
          },
          PaliSyscoinEvents.xpubChanged
        )
      : _dispatchPaliEvent(
          dapp.host,
          {
            method: PaliEvents.accountsChanged,
            params: [_dapps[dapp.host].activeAddress],
          },
          PaliEvents.accountsChanged
        );
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
    // Safety check: ensure the dapp session exists
    if (!_dapps[host]) {
      console.warn(
        `[DAppController] Cannot change account for ${host} - session not initialized`
      );
      return;
    }

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

        // Trigger disconnection notification
        notificationManager.notifyDappConnection(host, false);

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

          // Trigger disconnection notification
          notificationManager.notifyDappConnection(host, false);

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

        // Validate input data - params can be null for some events like pali_accountsChanged on UTXO
        if (!data || !data.method || data.params === undefined) {
          console.warn(
            '[DAppController] handleStateChange received invalid data:',
            { id, data }
          );
          resolve();
          return;
        }

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
        reject(`${error}`);
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
    // Don't dispatch notifications with undefined or invalid data
    if (!data || !data.method || data.method === 'undefined') {
      console.warn(
        '[DAppController] Skipping paliNotification dispatch - invalid data:',
        { id, data, host }
      );
      return;
    }

    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ url: `*://${host}/*` }, resolve);
    });

    if (tabs && tabs.length) {
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: (eventData) => {
              const event = new CustomEvent('paliNotification', {
                detail: JSON.stringify(eventData),
              });
              window.dispatchEvent(event);
            },
            args: [{ id, data }],
          });
        }
      });
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

  const getNetwork = (): INetwork => {
    const { activeNetwork } = store.getState().vault;

    // Return the exact network object from Redux state to preserve kind property
    return activeNetwork;
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
