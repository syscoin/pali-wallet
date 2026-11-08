import {
  createDappSessions,
  type DappSessionEvent,
} from '../../../wallet/dappSessions';
import { notificationManager } from '../notification-manager';
import store, { dappPermissionPort } from 'state/store';
import type { IDAppController } from 'types/controllers';
import { removeSensitiveDataFromVault, removeXprv } from 'utils/account';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { getDappOrigin, matchAttestedDappOrigin } from 'utils/dappOrigin';
import { canPublishAccountAddress } from 'utils/smartAccount/addressIdentity';

import { clearProviderCache } from './message-handler/provider-cache';

const dispatchPropertyChange = async (id: string) => {
  if (!chrome.tabs || !chrome.runtime?.id) return;
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (result) => {
      resolve(chrome.runtime.lastError ? [] : result || []);
    });
  });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && getDappOrigin(tab.url || ''))
      .map((tab) =>
        chrome.tabs.sendMessage(
          tab.id!,
          { id, data: { method: id, params: { type: id } } },
          { frameId: 0 }
        )
      )
  );
};

/** Browser discovery and document attestation are transport responsibilities. */
const resolveDelivery = async (origin: string, id: string) => {
  if (!chrome.tabs || !chrome.scripting || !chrome.runtime?.id) return null;
  const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query({ url: `${origin}/*` }, (result) => {
      resolve(chrome.runtime.lastError ? [] : result || []);
    });
  });
  const targets = tabs.filter(
    (tab, index) =>
      getDappOrigin(tab.url || '') === origin &&
      index === tabs.findIndex((other) => other.id === tab.id)
  );
  if (targets.length === 0) return null;
  return async (prepare: () => DappSessionEvent, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    await Promise.allSettled(
      targets.map(async (tab) => {
        if (!isCurrent() || !tab.id) return;
        const event = prepare();
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          func: (eventJson, approvedOrigin) => {
            if (self.origin !== approvedOrigin) return;
            window.dispatchEvent(
              new CustomEvent('paliNotification', { detail: eventJson })
            );
          },
          args: [JSON.stringify({ id, data: event }), origin],
        });
      })
    );
  };
};

/** The extension adapter supplies public state and browser transport to one shared owner. */
const DAppController = (
  isWalletUnlocked: () => boolean,
  getWalletStateGeneration: () => number
): IDAppController => {
  if (
    typeof isWalletUnlocked !== 'function' ||
    typeof getWalletStateGeneration !== 'function'
  )
    throw new TypeError('Wallet authority callbacks are required');
  const sessions = createDappSessions({
    wallet() {
      const { vault, vaultGlobal } = store.getState();
      return {
        generation: getWalletStateGeneration(),
        unlocked: isWalletUnlocked(),
        network: vault.activeNetwork,
        isBitcoinBased: vault.isBitcoinBased,
        activeSlip44: vaultGlobal?.activeSlip44,
      };
    },
    account(id, type) {
      const account = store.getState().vault.accounts[type]?.[id];
      return account && removeXprv(account);
    },
    canPublishAccount: (account, type, network) =>
      canPublishAccountAddress(account, type, network.chainId),
    isAccountAvailable: (account, type, network) =>
      isAccountCompatibleWithNetwork(account, type, network) &&
      canPublishAccountAddress(account, type, network.chainId),
    permissions: dappPermissionPort,
    resolveDelivery,
    providerAvailability: dispatchPropertyChange,
    notifyConnection: (origin, connected) =>
      notificationManager.notifyDappConnection(origin, connected),
    clearProviderCache,
    now: () => Date.now(),
    reportError: (operation, error) =>
      console.error(`[DAppController] ${operation}:`, error),
  });
  return {
    ...sessions,
    setup(sender) {
      const origin =
        sender && matchAttestedDappOrigin(sender.url, sender.origin);
      if (origin) sessions.setup(origin);
    },
    hasWindow: sessions.hasApproval,
    setHasWindow: sessions.setApprovalOpen,
    getState: () => removeSensitiveDataFromVault(store.getState().vault),
    getNetwork() {
      const network = { ...store.getState().vault.activeNetwork };
      delete network.apiUrl;
      return network;
    },
  };
};
export default DAppController;
