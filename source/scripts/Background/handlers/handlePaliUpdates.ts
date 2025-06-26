import { INetworkType } from '@pollum-io/sysweb3-network';

import { getController } from '..';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import { saveState } from 'state/paliStorage';
import store from 'state/store';
import { setPrevBalances } from 'state/vault';
import { IVaultState } from 'state/vault/types';

function shouldUpdate() {
  const vault = store.getState().vault as unknown as IVaultState;

  if (!vault) {
    return false;
  }

  const {
    accounts,
    activeAccount,
    isBitcoinBased,
    activeNetwork,
    prevBalances,
    accountTransactions,
  } = vault;

  const chain = isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum;
  const chainId = activeNetwork.chainId;

  const currentBalance = isBitcoinBased
    ? accounts[activeAccount.type][activeAccount.id].balances[
        INetworkType.Syscoin
      ]
    : accounts[activeAccount.type][activeAccount.id].balances[
        INetworkType.Ethereum
      ];

  const previousBalance = prevBalances[activeAccount.id]?.[chain]?.[chainId];
  const currentAccountTransactions = accountTransactions[activeAccount.type][
    activeAccount.id
  ][chain]?.[chainId] as any[];

  // Check if there are any pending transactions (confirmations === 0)
  const hasPendingTransactions = Array.isArray(currentAccountTransactions)
    ? currentAccountTransactions.some((tx) => tx.confirmations === 0)
    : false;

  // Always update if:
  // 1. Balance has changed
  // 2. There are pending transactions (need to check confirmations)
  // 3. First time checking (no previous balance)
  const shouldPerformUpdate =
    currentBalance !== previousBalance ||
    hasPendingTransactions ||
    previousBalance === undefined;

  if (shouldPerformUpdate && currentBalance !== undefined) {
    store.dispatch(
      setPrevBalances({
        activeAccountId: activeAccount.id,
        balance: currentBalance,
        chain: isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum,
        chainId: activeNetwork.chainId,
      })
    );
  }

  return shouldPerformUpdate;
}

// Cross-context deduplication using Chrome storage
const UPDATE_LOCK_KEY = 'checkForUpdates_lock';
const MIN_CHECK_INTERVAL = 1000; // 1 second minimum between checks

// Helper to acquire lock across all contexts (background script instances)
const acquireUpdateLock = async (): Promise<boolean> => {
  // Add random delay to prevent race conditions between multiple instances
  const randomDelay = Math.floor(Math.random() * 100) + 50; // 50-150ms
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  const now = Date.now();
  const instanceId = Math.random().toString(36).substr(2, 9);

  return new Promise((resolve) => {
    chrome.storage.local.get([UPDATE_LOCK_KEY], (result) => {
      const lockData = result[UPDATE_LOCK_KEY];

      // Check if lock exists and is still valid
      if (lockData && now - lockData.timestamp < MIN_CHECK_INTERVAL) {
        console.log(
          `⏸️ checkForUpdates: Another instance (${lockData.instanceId}) is checking or checked recently, skipping`
        );
        resolve(false);
        return;
      }

      // Acquire lock with instance tracking
      chrome.storage.local.set(
        {
          [UPDATE_LOCK_KEY]: {
            timestamp: now,
            instanceId: instanceId,
          },
        },
        () => {
          // Double-check we still have the lock after setting it
          chrome.storage.local.get([UPDATE_LOCK_KEY], (doubleCheckResult) => {
            const currentLock = doubleCheckResult[UPDATE_LOCK_KEY];
            if (currentLock && currentLock.instanceId === instanceId) {
              console.log(
                `🔒 checkForUpdates: Acquired lock, proceeding (instance: ${instanceId})`
              );
              resolve(true);
            } else {
              console.log(
                `⏸️ checkForUpdates: Lost lock race condition, another instance acquired it`
              );
              resolve(false);
            }
          });
        }
      );
    });
  });
};

// Helper to release lock
const releaseUpdateLock = () => {
  chrome.storage.local.remove([UPDATE_LOCK_KEY]);
};

export async function checkForUpdates() {
  // Try to acquire cross-context lock
  const hasLock = await acquireUpdateLock();
  if (!hasLock) {
    return;
  }

  try {
    if (isPollingRunNotValid()) {
      return;
    }

    if (!shouldUpdate()) {
      return;
    }

    console.log('✅ checkForUpdates: Proceeding with update');

    // Always use direct controller call since we're already in the background
    // This avoids unnecessary errors when popup is closed
    try {
      await getController().wallet.getLatestUpdateForCurrentAccount(true);

      // Save state after successful update
      saveState(store.getState());
    } catch (error) {
      console.error('Error updating account in checkForUpdates:', error);
    }
  } catch (error) {
    console.error('Error in checkForUpdates:', error);
  } finally {
    // Always release the lock
    releaseUpdateLock();
  }
}
