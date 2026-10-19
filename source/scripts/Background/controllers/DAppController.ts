import { INetwork } from '@sidhujag/sysweb3-network';

import { notificationManager } from '../notification-manager';
import { removeDApp, updateDAppAccount } from 'state/dapp';
import { IDApp } from 'state/dapp/types';
import store, {
  persistDappPermissionGrant,
  persistMainStateStrict,
  saveMainState,
} from 'state/store';
import { IOmittedVault } from 'state/vault/types';
import {
  IDAppAccountSelectionContext,
  IDAppController,
  IDAppDisconnectOptions,
} from 'types/controllers';
import { KeyringAccountType } from 'types/network';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { getDappOrigin } from 'utils/dappOrigin';

import { clearProviderCache } from './message-handler/provider-cache';
import { PaliEvents, PaliSyscoinEvents } from './message-handler/types';

interface IDappsSession {
  [host: string]: {
    activeAddress: string | null;
    hasWindow: boolean;
  };
}

const dispatchPropertyChange = async (
  id: PaliEvents.addProperty | PaliEvents.removeProperty
) => {
  if (!chrome.tabs || !chrome.runtime?.id) return;
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (result) => {
      resolve(chrome.runtime.lastError ? [] : result || []);
    });
  });
  // Provider availability is public and independent of account permission.
  // Use the existing content-script receiver, not the account event channel.
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && getDappOrigin(tab.url || ''))
      .map((tab) =>
        chrome.tabs.sendMessage(
          tab.id,
          { id, data: { method: id, params: { type: id } } },
          { frameId: 0 }
        )
      )
  );
};

/**
 * Controls the dapp store
 *
 * DApps connections use the site host as id
 */
const DAppController = (
  isWalletUnlocked: () => boolean = () => false
): IDAppController => {
  const _dapps: IDappsSession = {};
  const pendingGrants = new Map<string, object>();
  // Only origins whose real permission removal is pending may occupy this
  // bounded retry state. Unconnected pages cannot populate it or force writes.
  const pendingRevocations = new Map<string, { inFlight?: Promise<void> }>();
  const MAX_PENDING_REVOCATIONS = 256;

  const persistDappState = async (operation: string, strict = false) => {
    try {
      if (strict) await persistMainStateStrict();
      else await saveMainState();
    } catch (error) {
      console.error(`[DAppController] Failed to persist ${operation}:`, error);
      throw error;
    }
  };

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
      const host = getDappOrigin(sender.url);
      if (!host) return;
      if (!isConnected(host)) {
        delete _dapps[host];
        return;
      }

      const { isBitcoinBased } = store.getState().vault;
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

  const connect = async (
    dapp: IDApp,
    expectedContext: IDAppAccountSelectionContext
  ) => {
    if (!expectedContext)
      throw new Error('Account selection context is required');
    await grantAccountPermission(
      dapp.host,
      dapp.accountId,
      dapp.accountType,
      expectedContext,
      dapp
    );
  };

  const validateAccountSelection = (
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext
  ) => {
    const {
      accounts,
      activeNetwork: network,
      isBitcoinBased,
    } = store.getState().vault;
    const account = accounts[accountType]?.[accountId];
    if (
      !account ||
      !isAccountCompatibleWithNetwork(account, accountType, network)
    )
      throw new Error('Account is not available on the active network');
    if (expectedContext !== undefined) {
      const sameAddress =
        typeof expectedContext?.address === 'string' &&
        (isBitcoinBased
          ? account.address === expectedContext.address
          : account.address.toLowerCase() ===
            expectedContext.address.toLowerCase());
      if (
        !sameAddress ||
        account.xpub !== expectedContext?.xpub ||
        network.kind !== expectedContext?.network?.kind ||
        network.chainId !== expectedContext?.network?.chainId ||
        network.url !== expectedContext?.network?.url ||
        network.slip44 !== expectedContext?.network?.slip44
      )
        throw new Error(
          'Account context changed. Please select an account again.'
        );
    }
    return { account, network, isBitcoinBased };
  };

  const grantAccountPermission = (
    host: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext,
    connectionDetails?: IDApp
  ) => {
    // Validate before touching the grant or session, including identities that
    // changed while the approval message was travelling to the worker.
    const { account, network, isBitcoinBased } = validateAccountSelection(
      accountId,
      accountType,
      expectedContext
    );
    if (
      connectionDetails &&
      (connectionDetails.chain !== network.kind ||
        connectionDetails.chainId !== network.chainId)
    )
      throw new Error('Connection network context changed');
    if (pendingGrants.has(host))
      throw new Error('A permission grant is already pending for this site');
    const date = connectionDetails?.date ?? Date.now();
    const state = store.getState();
    const existingDapp = state.dapp.dapps[host];
    const grant = connectionDetails
      ? { ...connectionDetails }
      : existingDapp
      ? { ...existingDapp, accountId, accountType, date }
      : {
          host,
          accountId,
          accountType,
          date,
          chain: network.kind,
          chainId: network.chainId,
        };
    const address = account.address;
    const xpub = account.xpub;
    const selectedNetwork = { ...network };
    const attempt = {};
    pendingGrants.set(host, attempt);
    const isCurrent = () => {
      const { accounts, activeNetwork } = store.getState().vault;
      const current = accounts[accountType]?.[accountId];
      return (
        pendingGrants.get(host) === attempt &&
        current?.address === address &&
        current?.xpub === xpub &&
        isAccountCompatibleWithNetwork(current, accountType, activeNetwork) &&
        // Initial connection approval also promises its advertised network.
        // An existing permission request admits the selected identity across
        // compatible EVM networks and retains that established behavior.
        (!connectionDetails ||
          (activeNetwork.kind === selectedNetwork.kind &&
            activeNetwork.chainId === selectedNetwork.chainId &&
            activeNetwork.url === selectedNetwork.url &&
            activeNetwork.slip44 === selectedNetwork.slip44))
      );
    };

    return persistDappPermissionGrant(grant, existingDapp, isCurrent)
      .finally(clearProviderCache)
      .then(() => {
        if (!isCurrent() || store.getState().dapp.dapps[host] !== grant)
          throw new Error('Permission grant context changed');
        if (!_dapps[host])
          _dapps[host] = { activeAddress: '', hasWindow: false };

        if (connectionDetails)
          notificationManager.notifyDappConnection(host, true);

        _dapps[host].activeAddress = isBitcoinBased
          ? account.xpub
          : account.address;

        // For UTXO, also send xpubChanged for consumers that track xpub directly
        if (isBitcoinBased) {
          _dispatchPaliEvent(
            host,
            {
              method: PaliSyscoinEvents.xpubChanged,
              params: account.xpub,
            },
            PaliSyscoinEvents.xpubChanged
          );
        }

        // Always dispatch accountsChanged with the address for consistency across network types
        _dispatchPaliEvent(
          host,
          {
            method: PaliEvents.accountsChanged,
            params: [account.address],
          },
          PaliEvents.accountsChanged
        );

        return { account, network, isBitcoinBased, date };
      })
      .finally(() => {
        if (pendingGrants.get(host) === attempt) pendingGrants.delete(host);
      });
  };

  const requestPermissions = (
    host: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext
  ) =>
    grantAccountPermission(host, accountId, accountType, expectedContext).then(
      ({ account, network, isBitcoinBased, date }) => {
        const response: any = [
          {
            id: '1',
            parentCapability: 'eth_accounts',
            invoker: host,
            caveats: [
              { type: 'restrictReturnedAccounts', value: [account.address] },
            ],
            date,
          },
        ];
        if (!isBitcoinBased)
          response.push({
            id: '2',
            parentCapability: 'endowment:permitted-chains',
            invoker: host,
            caveats: [
              {
                type: 'restrictNetworkSwitching',
                value: [`0x${network.chainId.toString(16)}`],
              },
            ],
            date,
          });
        return response;
      }
    );

  const changeAccount = async (
    host: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext
  ) => {
    if (!store.getState().dapp.dapps[host])
      throw new Error('Unable to update account. DApp does not exist');
    // The admitted permission change must survive without the approval view's
    // optional wallet switch. Publish and notify only after its durable write.
    await grantAccountPermission(host, accountId, accountType, expectedContext);
  };

  const syncAccountSession = (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => {
    const date = Date.now();
    const { accounts, isBitcoinBased } = store.getState().vault;
    const account = accounts[accountType]?.[accountId];
    if (!account) return;

    store.dispatch(updateDAppAccount({ host, accountId, date, accountType }));

    if (!_dapps[host]) {
      _dapps[host] = { activeAddress: '', hasWindow: false };
    }

    _dapps[host].activeAddress = isBitcoinBased
      ? account.xpub
      : account.address;
  };

  const dispatchDisconnectedAccounts = (host: string) => {
    _dispatchPaliEvent(
      host,
      { method: PaliEvents.accountsChanged, params: [] },
      PaliEvents.accountsChanged
    ).catch((error) => {
      console.warn(
        '[DAppController] Failed to dispatch accountsChanged on disconnect:',
        error
      );
    });
    _dispatchPaliEvent(
      host,
      { method: PaliSyscoinEvents.xpubChanged, params: null },
      PaliSyscoinEvents.xpubChanged
    ).catch((error) => {
      console.warn(
        '[DAppController] Failed to dispatch xpubChanged on disconnect:',
        error
      );
    });
  };

  const notifyDisconnected = (host: string) => {
    notificationManager.notifyDappConnection(host, false);
    dispatchDisconnectedAccounts(host);
  };

  const disconnectDurably = (
    host: string,
    allowAlreadyDisconnected: boolean,
    canceledGrant = false
  ): Promise<void> => {
    const pending = pendingRevocations.get(host);
    if (pending?.inFlight) {
      if (canceledGrant || _dapps[host] || getAll()[host]) {
        // A newer or unpublished grant is not covered by the earlier write.
        // Queue its removal after both that attempt and the staged grant write.
        const revokeCurrentPermission = () =>
          disconnectDurably(host, allowAlreadyDisconnected, canceledGrant);
        return pending.inFlight.then(
          revokeCurrentPermission,
          revokeCurrentPermission
        );
      }
      return pending.inFlight;
    }
    if (!pending && !canceledGrant && !_dapps[host] && !getAll()[host]) {
      if (allowAlreadyDisconnected) {
        // Another main-state save may have persisted a failed removal before
        // the worker restarted and lost its retry map. Reconcile the caller's
        // provider state without another storage write or connection toast.
        dispatchDisconnectedAccounts(host);
        return Promise.resolve();
      }
      return Promise.reject(new Error('DApp not connected'));
    }
    if (!pending && pendingRevocations.size >= MAX_PENDING_REVOCATIONS) {
      return Promise.reject(
        new Error('Too many pending revocations; retry an earlier revocation')
      );
    }
    const entry = pending || {};
    pendingRevocations.set(host, entry);
    // Install the shared promise before work begins so concurrent same-origin
    // requests cannot write or emit the disconnect events more than once.
    entry.inFlight = Promise.resolve()
      .then(async () => {
        await persistDappState('dapp disconnect', true);
        // A newly approved connection must not receive stale disconnect UI.
        if (!_dapps[host] && !getAll()[host]) notifyDisconnected(host);
        pendingRevocations.delete(host);
      })
      .catch((error) => {
        entry.inFlight = undefined;
        throw error;
      });
    // Remove synchronously after installing the shared attempt, so another
    // ordinary revoke joins it rather than mistaking this permission for new.
    if (_dapps[host] || getAll()[host]) {
      delete _dapps[host];
      store.dispatch(removeDApp(host));
    }
    return entry.inFlight;
  };

  const disconnect = async (
    host: string,
    persist = true,
    options: IDAppDisconnectOptions = {}
  ) => {
    const canceledGrant = pendingGrants.delete(host);
    try {
      if (persist && options.propagateErrors) {
        await disconnectDurably(
          host,
          Boolean(options.allowAlreadyDisconnected),
          canceledGrant
        );
        return;
      }
      const previousConnectedDapps = getAll();
      const isInActiveSession = Boolean(_dapps[host]);

      switch (isInActiveSession) {
        case true:
          delete _dapps[host];
          store.dispatch(removeDApp(host));
          if (persist) {
            await persistDappState('dapp disconnect', options.propagateErrors);
          }

          notifyDisconnected(host);
          break;
        case false:
          if (previousConnectedDapps[host]) {
            store.dispatch(removeDApp(host));
            if (persist) {
              await persistDappState(
                'dapp disconnect',
                options.propagateErrors
              );
            }

            notifyDisconnected(host);
          } else if (!options.allowAlreadyDisconnected) {
            throw new Error('DApp not connected');
          }
          break;
      }
    } catch (error) {
      console.error('[DAppController] Error in disconnect:', error);
      // Permission revocation needs the real result; keep legacy callers best-effort.
      if (options.propagateErrors || error.message === 'DApp not connected') {
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

        if (id === PaliEvents.addProperty || id === PaliEvents.removeProperty) {
          dispatchPropertyChange(id).then(resolve, reject);
          return;
        }

        for (const host of hosts) _dispatchPaliEvent(host, data, id);
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

  const publicAccountEvent = (
    host: string,
    data: { method: string; params: any }
  ) => {
    if (
      data.method !== PaliEvents.accountsChanged &&
      data.method !== PaliSyscoinEvents.xpubChanged &&
      data.method !== PaliEvents.lockStateChanged
    ) {
      return data;
    }

    // Re-read after the asynchronous tab lookup. A global account change must
    // never disclose another site's account, nor a revoked/locked connection.
    const { vault, dapp } = store.getState();
    const connection = dapp?.dapps?.[host];
    const account = connection
      ? vault.accounts[connection.accountType]?.[connection.accountId]
      : undefined;
    const isUnlocked =
      isWalletUnlocked() &&
      (data.method !== PaliEvents.lockStateChanged ||
        data.params?.isUnlocked === true);
    const mayDisclose =
      isUnlocked &&
      connection &&
      isAccountCompatibleWithNetwork(
        account,
        connection.accountType,
        vault.activeNetwork
      );
    const address = mayDisclose ? account.address : null;
    const xpub =
      mayDisclose && vault.isBitcoinBased ? account.xpub || null : null;

    if (data.method === PaliEvents.lockStateChanged) {
      return {
        method: data.method,
        params: { isUnlocked, accounts: address ? [address] : [], xpub },
      };
    }
    return {
      method: data.method,
      params:
        data.method === PaliEvents.accountsChanged
          ? address
            ? [address]
            : []
          : xpub,
    };
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

    try {
      // Check if chrome APIs are available (service worker might be terminating)
      if (!chrome.tabs || !chrome.scripting || !chrome.runtime?.id) {
        console.warn(
          '[DAppController] Chrome APIs not available - service worker may be terminating'
        );
        return;
      }

      // Bare-host legacy permissions cannot identify the originally approved
      // scheme. Keep them visible/removable in settings, but never grant access
      // or send account events until the site reconnects with an origin key.
      const origin = getDappOrigin(host);
      if (!origin || origin !== host) return;
      const queryPatterns = [`${origin}/*`];
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
        (tab, index, self) =>
          getDappOrigin(tab.url || '') === origin &&
          index === self.findIndex((t) => t.id === tab.id)
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
                func: (eventData, approvedOrigin) => {
                  // The tab can navigate after tabs.query returns. Check in
                  // the receiving document before exposing account events.
                  if (window.location.origin !== approvedOrigin) return;
                  const event = new CustomEvent('paliNotification', {
                    detail: JSON.stringify(eventData),
                  });
                  window.dispatchEvent(event);
                },
                args: [{ id, data: publicAccountEvent(host, data) }, origin],
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
    syncAccountSession,
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
