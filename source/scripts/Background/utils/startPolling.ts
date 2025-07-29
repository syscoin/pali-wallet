import store from 'state/store';
import { pollingMutex } from 'utils/asyncMutex';
import { checkIfPopupIsOpen } from 'utils/checkPopupOpen';
import { isTransactionInBlock } from 'utils/transactionUtils';

// Export the function so it can be imported elsewhere
export async function getPollingInterval() {
  const {
    isBitcoinBased,
    accounts,
    activeAccount,
    activeNetwork,
    accountTransactions,
  } = store.getState().vault;

  // Check if there are pending transactions
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  // Check if popup is open for more responsive updates
  const isPopupOpen = await checkIfPopupIsOpen();

  if (currentAccount) {
    const chain = isBitcoinBased ? 'syscoin' : 'ethereum';
    const transactions =
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.[chain]?.[
        activeNetwork.chainId
      ] || [];
    const hasPendingTransactions =
      Array.isArray(transactions) &&
      transactions.some((tx: any) => !isTransactionInBlock(tx));

    // Use rapid polling when there are pending transactions
    if (hasPendingTransactions || isPopupOpen) {
      return isBitcoinBased ? 2 : 1; // Original intervals: 2 min for UTXO, 1 min for EVM
    }
  }

  // Slower polling when idle (no pending transactions)
  // This saves resources when wallet is just sitting idle
  return isBitcoinBased ? 5 : 3; // 5 min for UTXO, 3 min for EVM when idle
}

export async function startPolling() {
  // Use AsyncMutex for cross-context synchronization
  // This ensures only one instance manages the polling alarm
  return pollingMutex.runExclusive(async () => {
    try {
      // Clear and recreate with new interval (needed to update polling frequency)
      return new Promise<void>((resolve, reject) => {
        chrome.alarms.clear('check_for_updates', async () => {
          try {
            const interval = await getPollingInterval();
            console.log(
              `🎯 startPolling: Creating polling alarm with ${interval} minute interval`
            );
            chrome.alarms.create('check_for_updates', {
              periodInMinutes: interval,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Error in startPolling:', error);
      throw error;
    }
  });
}
