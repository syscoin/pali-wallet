import store from 'state/store';

// Export the function so it can be imported elsewhere
export function getPollingInterval() {
  const { isBitcoinBased, accounts, activeAccount, activeNetwork } =
    store.getState().vault;

  // Check if there are pending transactions
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  if (currentAccount) {
    const chain = isBitcoinBased ? 'syscoin' : 'ethereum';
    const transactions =
      currentAccount.transactions?.[chain]?.[activeNetwork.chainId] || [];
    const hasPendingTransactions =
      Array.isArray(transactions) &&
      transactions.some((tx: any) => tx.confirmations === 0);

    // Use original fast polling when there are pending transactions
    if (hasPendingTransactions) {
      return isBitcoinBased ? 2 : 1; // Original intervals: 2 min for UTXO, 1 min for EVM
    }
  }

  // Slower polling when idle (no pending transactions)
  // This saves resources when wallet is just sitting idle
  return isBitcoinBased ? 5 : 3; // 5 min for UTXO, 3 min for EVM when idle
}

export function startPolling() {
  chrome.alarms.clear('check_for_updates', () => {
    chrome.alarms.create('check_for_updates', {
      periodInMinutes: getPollingInterval(),
    });
  });
}
