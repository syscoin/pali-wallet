import { KeyringAccountType } from '@sidhujag/sysweb3-keyring';
import { INetwork } from '@sidhujag/sysweb3-network';

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

  const connect = (dapp: IDApp) => {
    // Always update the connection in the store to ensure fresh state
    store.dispatch(addDApp(dapp));

    const { accounts, isBitcoinBased } = store.getState().vault;
    _dapps[dapp.host] = { activeAddress: '', hasWindow: false };

    const account = accounts[dapp.accountType]?.[dapp.accountId];
    if (!account) {
      // Clean up invalid connection
      delete _dapps[dapp.host];
      store.dispatch(removeDApp(dapp.host));
      throw new Error('Account not found');
    }

    _dapps[dapp.host].activeAddress = isBitcoinBased
      ? account.xpub
      : account.address;

    // Always trigger connection notification for user feedback
    notificationManager.notifyDappConnection(dapp.host, true);

    // Always dispatch events to ensure dapp state is updated
    isBitcoinBased
      ? _dispatchPaliEvent(
          dapp.host,
          {
            method: PaliSyscoinEvents.xpubChanged,
            params: account.xpub,
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
    const network = getNetwork();

    // Check if dapp exists, if not create it first
    const state = store.getState();
    const existingDapp = state.dapp.dapps[host];

    if (!existingDapp) {
      // Create the dapp first
      store.dispatch(
        addDApp({
          host,
          accountId,
          accountType,
          date,
          chain: network.kind,
          chainId: network.chainId,
        })
      );
    } else {
      // Update existing dapp
      store.dispatch(updateDAppAccount({ host, accountId, accountType, date }));
    }

    const { accounts, isBitcoinBased } = store.getState().vault;

    const account = accounts[accountType]?.[accountId];

    if (!account) {
      // Return empty permissions array instead of null
      // Don't dispatch here - the popup will handle it
      return [];
    }

    // Ensure dapp session exists
    if (!_dapps[host]) {
      _dapps[host] = { activeAddress: '', hasWindow: false };
    }

    const response: any = [
      {
        id: '1',
        parentCapability: 'eth_accounts',
        invoker: host,
        caveats: [
          {
            type: 'restrictReturnedAccounts',
            value: [account.address], // Return address string, not full account object
          },
        ],
        date: date,
      },
    ];

    // Add endowment:permitted-chains permission for EVM networks
    if (!isBitcoinBased) {
      response.push({
        id: '2',
        parentCapability: 'endowment:permitted-chains',
        invoker: host,
        caveats: [
          {
            type: 'restrictNetworkSwitching',
            value: [`0x${network.chainId.toString(16)}`], // Convert to hex format with 0x prefix
          },
        ],
        date: date,
      });
    }

    _dapps[host].activeAddress = isBitcoinBased
      ? account.xpub
      : account.address;

    // Dispatch accountsChanged event to notify dapp of new permissions
    _dispatchPaliEvent(
      host,
      {
        method: PaliEvents.accountsChanged,
        params: [_dapps[host].activeAddress],
      },
      PaliEvents.accountsChanged
    );

    // Return the response for the popup promise
    return response;
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

    const account = accounts[accountType]?.[accountId];
    if (!account) {
      console.error(
        '[DAppController] Account not found:',
        accountType,
        accountId
      );
      return;
    }

    store.dispatch(updateDAppAccount({ host, accountId, date, accountType }));
    _dapps[host].activeAddress = isBitcoinBased
      ? account.xpub
      : account.address;

    isBitcoinBased
      ? _dispatchPaliEvent(
          host,
          {
            method: PaliSyscoinEvents.xpubChanged,
            params: account.xpub,
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
    try {
      const previousConnectedDapps = getAll();
      const isInActiveSession = Boolean(_dapps[host]);

      switch (isInActiveSession) {
        case true:
          _dapps[host].activeAddress = null;
          store.dispatch(removeDApp(host));

          // Trigger disconnection notification
          notificationManager.notifyDappConnection(host, false);

          // Dispatch events but don't await them to prevent blocking
          _dispatchPaliEvent(
            host,
            {
              method: PaliEvents.accountsChanged,
              params: [],
            },
            PaliEvents.accountsChanged
          ).catch((error) => {
            console.warn(
              `[DAppController] Failed to dispatch accountsChanged on disconnect:`,
              error
            );
          });

          _dispatchPaliEvent(
            host,
            {
              method: PaliSyscoinEvents.xpubChanged,
              params: null,
            },
            PaliSyscoinEvents.xpubChanged
          ).catch((error) => {
            console.warn(
              `[DAppController] Failed to dispatch xpubChanged on disconnect:`,
              error
            );
          });
          break;
        case false:
          if (previousConnectedDapps[host]) {
            store.dispatch(removeDApp(host));

            // Trigger disconnection notification
            notificationManager.notifyDappConnection(host, false);

            // Dispatch events but don't await them to prevent blocking
            _dispatchPaliEvent(
              host,
              {
                method: PaliEvents.accountsChanged,
                params: [],
              },
              PaliEvents.accountsChanged
            ).catch((error) => {
              console.warn(
                `[DAppController] Failed to dispatch accountsChanged on disconnect:`,
                error
              );
            });

            _dispatchPaliEvent(
              host,
              {
                method: PaliSyscoinEvents.xpubChanged,
                params: null,
              },
              PaliSyscoinEvents.xpubChanged
            ).catch((error) => {
              console.warn(
                `[DAppController] Failed to dispatch xpubChanged on disconnect:`,
                error
              );
            });
          } else {
            throw new Error('DApp not connected');
          }
          break;
      }
    } catch (error) {
      console.error('[DAppController] Error in disconnect:', error);
      // Re-throw only if it's a known error that should be handled upstream
      if (error.message === 'DApp not connected') {
        throw error;
      }
      // Otherwise, log and continue to prevent service worker crashes
    }
  };
  //HandleStateChange purpose is to dispatch notifications that are meant to be globally
  //broadcasted to all Dapps on browser being them connected or not
  //The lockStateChanged and chainChanged events, that should be globally updated
  //So that's why it is fetching all hosts
  const handleStateChange = async (
    id: PaliEvents,
    data: { method: string; params: any }
  ): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      try {
        const hosts = Object.keys(_dapps);

        // Validate input data - params can be null for some events like pali_accountsChanged on UTXO
        if (!data || !data.method || data.params === undefined) {
          console.warn(
            '[DAppController] handleStateChange received invalid data:',
            { id, data }
          );
          resolve();
          return;
        }

        for (const host of hosts) {
          if (id === PaliEvents.lockStateChanged && _dapps[host]) {
            // For lock state, we need to customize the event with dapp's connected account
            const lockStateData = {
              method: PaliSyscoinEvents.lockStateChanged,
              params: {
                ...data.params,
                accounts: data.params.isUnlocked
                  ? [_dapps[host].activeAddress]
                  : [],
                xpub: data.params.isUnlocked
                  ? _dapps[host].activeAddress
                  : null,
              },
            };
            _dispatchPaliEvent(
              host,
              lockStateData,
              PaliSyscoinEvents.lockStateChanged
            );
          } else {
            // For all other events, dispatch as-is (including accountsChanged from wallet)
            _dispatchPaliEvent(host, data, id);
          }
        }
        resolve();
      } catch (error) {
        reject(`${error}`);
      }
    });

  const handleBlockExplorerChange = async (
    id: PaliSyscoinEvents,
    data: { method: string; params: any }
  ): Promise<void> =>
    new Promise<void>((resolve) => {
      const hosts = Object.keys(_dapps);
      for (const host of hosts) {
        _dispatchPaliEvent(host, data, id);
      }
      resolve();
    });

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

    try {
      // Check if chrome APIs are available (service worker might be terminating)
      if (!chrome.tabs || !chrome.scripting || !chrome.runtime?.id) {
        console.warn(
          '[DAppController] Chrome APIs not available - service worker may be terminating'
        );
        return;
      }

      // For hosts with ports, we need to query with specific protocols
      const queryPatterns: string[] = [];

      if (host.includes(':')) {
        // Host has a port (e.g., localhost:3000)
        queryPatterns.push(`http://${host}/*`);
        queryPatterns.push(`https://${host}/*`);
      } else {
        // Host without port - use wildcard
        queryPatterns.push(`*://${host}/*`);
      }
      // Query tabs for each pattern and combine results
      const allTabs: chrome.tabs.Tab[] = [];

      for (const pattern of queryPatterns) {
        try {
          const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ url: pattern }, (result) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  `[DAppController] Warning querying tabs for ${pattern}:`,
                  chrome.runtime.lastError.message
                );
                resolve([]);
                return;
              }
              resolve(result || []);
            });
          });
          allTabs.push(...tabs);
        } catch (queryError) {
          console.warn(
            `[DAppController] Error querying tabs for ${pattern}:`,
            queryError
          );
        }
      }

      // Remove duplicates (in case a tab matches multiple patterns)
      const uniqueTabs = allTabs.filter(
        (tab, index, self) => index === self.findIndex((t) => t.id === tab.id)
      );

      if (uniqueTabs.length > 0) {
        // Use Promise.allSettled to handle individual tab failures gracefully
        const injectionResults = await Promise.allSettled(
          uniqueTabs.map(async (tab) => {
            if (!tab.id) {
              return Promise.reject(new Error('Tab has no ID'));
            }

            try {
              // Skip chrome:// URLs and other protected pages
              if (
                tab.url &&
                (tab.url.startsWith('chrome://') ||
                  tab.url.startsWith('chrome-extension://') ||
                  tab.url.startsWith('edge://'))
              ) {
                return Promise.reject(new Error('Protected URL'));
              }

              return await chrome.scripting.executeScript({
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
            } catch (error) {
              // Don't let individual tab failures crash the service worker
              console.debug(
                `[DAppController] Could not inject event into tab ${tab.id}:`,
                error
              );
              return Promise.reject(error);
            }
          })
        );

        // Log summary of results
        const successful = injectionResults.filter(
          (r) => r.status === 'fulfilled'
        ).length;
        const failed = injectionResults.filter(
          (r) => r.status === 'rejected'
        ).length;

        if (successful > 0) {
          console.debug(
            `[DAppController] Event dispatched to ${successful} tab(s) for ${host}`
          );
        }
        if (failed > 0) {
          console.debug(
            `[DAppController] Failed to dispatch to ${failed} tab(s) for ${host} (this is normal for protected pages)`
          );
        }
      } else {
        console.debug(`[DAppController] No tabs found for host ${host}`);
      }
    } catch (error) {
      // Catch any unexpected errors to prevent service worker crash
      console.error(
        '[DAppController] Unexpected error in _dispatchPaliEvent:',
        error
      );
    }
  };

  //* ----- Getters/Setters -----
  const get = (host: string) => store.getState().dapp.dapps[host];

  const getAll = () => store.getState().dapp.dapps;

  const getAccount = (host: string) => {
    const dapp = store.getState().dapp.dapps[host];
    const { accounts } = store.getState().vault;
    if (!dapp) return null;

    // Safely check if account type exists before accessing account
    const accountsByType = accounts[dapp.accountType];
    if (!accountsByType) return null;

    const account = accountsByType[dapp.accountId];
    if (!account) return null;

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
