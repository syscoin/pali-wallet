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

  const hasPendingTx = Array.isArray(currentAccountTransactions)
    ? currentAccountTransactions.every((tx) => tx.confirmations > 0)
    : true;

  if (currentBalance === previousBalance && hasPendingTx) {
    return false;
  }

  store.dispatch(
    setPrevBalances({
      activeAccountId: activeAccount.id,
      balance: currentBalance,
      chain: isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum,
      chainId: activeNetwork.chainId,
    })
  );

  return true;
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
  ).catch(async (error) => {
    // save current state to localstorage if pali is not open
    if (
      error?.message ===
      'Could not establish connection. Receiving end does not exist.'
    ) {
      await getController().wallet.getLatestUpdateForCurrentAccount(true);
      saveState(store.getState());
    }
  });
}
