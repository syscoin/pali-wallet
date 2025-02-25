import { INetworkType } from '@pollum-io/sysweb3-network';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
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
    : accounts[activeAccount.type][activeAccount.id].balances.syscoin;

  const previousBalance = prevBalances[activeAccount.id]?.[chain]?.[chainId];
  const currentAccount = accounts[activeAccount.type][activeAccount.id];
  const currentAccountTransactions = currentAccount.transactions[chain][
    chainId
  ] as any[];

  const hasPendingTx = (currentAccountTransactions ?? []).every(
    (tx) => tx.confirmations > 0
  );

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

  const { activeAccount, isBitcoinBased, activeNetwork } =
    store.getState().vault;

  controllerEmitter(
    ['wallet', 'updateUserNativeBalance'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );

  controllerEmitter(
    ['wallet', 'updateUserTransactionsState'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );

  controllerEmitter(
    ['wallet', 'updateAssetsFromCurrentAccount'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );
}
