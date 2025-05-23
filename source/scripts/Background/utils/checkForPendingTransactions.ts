import { getController } from 'scripts/Background';
import { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import store from 'state/store';
import { TransactionsType } from 'state/vault/types';

export async function checkForPendingTransactionsUpdate() {
  const { accounts, activeAccount, activeNetwork, isBitcoinBased } =
    store.getState().vault;

  if (isPollingRunNotValid() || isBitcoinBased) {
    return;
  }

  const currentAccountTransactions =
    (accounts[activeAccount.type]?.[activeAccount.id]?.transactions[
      TransactionsType.Ethereum
    ]?.[activeNetwork.chainId] as IEvmTransactionResponse[]) ?? [];

  const pendingTransactions = currentAccountTransactions?.filter(
    (transaction) => transaction.confirmations === 0
  );

  if (pendingTransactions.length === 0) {
    return;
  }

  const maxTransactionsToSend = 3;

  for (let i = 0; i < pendingTransactions.length; i += maxTransactionsToSend) {
    const batchTransactions = pendingTransactions.slice(
      i,
      i + maxTransactionsToSend
    );

    const { wallet } = getController();

    wallet.validatePendingEvmTransactions({
      activeNetwork,
      activeAccount,
      pendingTransactions: batchTransactions,
    });

    // Add cooldown between batches to avoid overwhelming RPC endpoints
    if (i + maxTransactionsToSend < pendingTransactions.length) {
      const alarmName = `pending-tx-batch-cooldown-${Date.now()}`;

      await new Promise<void>((resolve) => {
        chrome.alarms.create(alarmName, { delayInMinutes: 1 });

        const handleCooldownAlarm = (alarm: chrome.alarms.Alarm) => {
          if (alarm.name === alarmName) {
            chrome.alarms.onAlarm.removeListener(handleCooldownAlarm);
            resolve();
          }
        };

        chrome.alarms.onAlarm.addListener(handleCooldownAlarm);
      });
    }
  }
}
