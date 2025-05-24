import { INetworkType } from '@pollum-io/sysweb3-network';

import { getController } from '..';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import { saveState } from 'state/paliStorage';
import store from 'state/store';
import { setPrevBalances } from 'state/vault';

function shouldUpdate() {
  const {
    accounts,
    activeAccount,
    isBitcoinBased,
    activeNetwork,
    prevBalances,
  } = store.getState().vault;

  const chain = isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum;
  const chainId = activeNetwork.chainId;

  const currentBalance = isBitcoinBased
    ? accounts[activeAccount.type][activeAccount.id].balances.syscoin
    : accounts[activeAccount.type][activeAccount.id].balances.ethereum;

  const previousBalance = prevBalances[activeAccount.id]?.[chain]?.[chainId];
  const currentAccount = accounts[activeAccount.type][activeAccount.id];
  const currentAccountTransactions = currentAccount.transactions[chain]?.[
    chainId
  ] as any[];

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

export async function checkForUpdates() {
  if (isPollingRunNotValid()) {
    return;
  }

  if (!shouldUpdate()) {
    return;
  }

  controllerEmitter(
    ['wallet', 'getLatestUpdateForCurrentAccount'],
    [true]
  ).catch((error) => {
    // save current state to localstorage if pali is not open
    if (
      error?.message ===
      'Could not establish connection. Receiving end does not exist.'
    ) {
      getController().wallet.getLatestUpdateForCurrentAccount(true);
      saveState(store.getState());
    }
  });
}
