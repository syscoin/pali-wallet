import { formatUnits } from '@ethersproject/units';

import { INetwork } from 'types/network';
import {
  formatDisplayValue,
  formatSyscoinValue,
} from 'utils/formatSyscoinValue';
import {
  setupNotificationListeners,
  showTransactionNotification,
  showNetworkChangeNotification,
  showAccountChangeNotification,
  showDappConnectionNotification,
  showErrorNotification,
  updatePendingTransactionBadge,
  ITransactionNotification,
} from 'utils/notifications';
import {
  getSyscoinTransactionTypeLabel,
  getSyscoinIntentAmount,
} from 'utils/syscoinTransactionUtils';
import { getTransactionDisplayInfo } from 'utils/transactions';
import { isTransactionInBlock } from 'utils/transactionUtils';
class NotificationManager {
  constructor() {
    // Set up notification click handlers
    setupNotificationListeners();
  }

  // Public method for MainController to notify network changes
  public notifyNetworkChange(newNetwork: INetwork) {
    showNetworkChangeNotification(newNetwork.label);
  }

  // Public method for MainController to notify account changes
  public notifyAccountChange(newAccount: { address: string; label?: string }) {
    showAccountChangeNotification(newAccount.address, newAccount.label);
  }

  // Public method for MainController to notify about transaction events
  // MainController determines when to call this and with what type
  public notifyTransaction(params: {
    account: { address: string; label?: string };
    isEvm: boolean;
    network: INetwork;
    transaction: any;
    type: 'pending' | 'confirmed' | 'failed';
  }) {
    const { transaction, type, account, network, isEvm } = params;

    // Simply show the notification based on what MainController tells us
    if (isEvm) {
      this.showEvmTransactionNotification(transaction, type, account, network);
    } else {
      this.showUtxoTransactionNotification(transaction, type, account, network);
    }
  }

  private async showEvmTransactionNotification(
    tx: any, // Extended EVM transaction
    type: 'pending' | 'confirmed' | 'failed',
    account: any,
    network: any
  ) {
    try {
      // Use the shared utility to get transaction display info
      const displayInfo = await getTransactionDisplayInfo(
        tx,
        network.currency,
        true // skipUnknownTokenFetch - don't fetch unknown tokens for notifications
      );

      let value: string | undefined;
      const tokenSymbol = displayInfo.displaySymbol;

      // Format the value appropriately for notifications
      if (displayInfo.isNft) {
        // For NFTs, the displayValue already contains the formatted string
        value = displayInfo.displayValue as string;
      } else {
        // For regular tokens and native currency
        value = displayInfo.formattedValue;
      }

      const notification: ITransactionNotification = {
        txHash: tx.hash,
        type,
        from: tx.from || account.address,
        to: displayInfo.actualRecipient || tx.to,
        value,
        tokenSymbol,
        network: network.label,
        chainId: network.chainId,
      };

      showTransactionNotification(notification);
    } catch (error) {
      console.error(
        '[NotificationManager] Error showing EVM transaction notification:',
        error
      );

      // Fallback to simple notification if the shared utility fails
      const notification: ITransactionNotification = {
        txHash: tx.hash,
        type,
        from: tx.from || account.address,
        to: tx.to,
        value: tx.value ? this.formatValue(tx.value.toString(), 18) : undefined,
        tokenSymbol: network.currency.toUpperCase(),
        network: network.label,
        chainId: network.chainId,
      };

      showTransactionNotification(notification);
    }
  }

  private async showUtxoTransactionNotification(
    tx: any, // Extended UTXO transaction with SPT fields
    type: 'pending' | 'confirmed' | 'failed',
    account: any,
    network: any
  ) {
    // Calculate net value for UTXO transactions
    let value = '0';
    let tokenSymbol = network.currency.toUpperCase();
    let decimals = 8; // Default for SYS
    const metadata: any = {};
    let transactionTypeLabel = '';

    let detectedTokenType: string | null = null;

    // Use stored transaction data directly (no need to decode hex again)
    if (tx.tokenType) {
      detectedTokenType = tx.tokenType;

      // Use getSyscoinIntentAmount for robust amount calculation
      const intent = getSyscoinIntentAmount(tx);
      if (intent) {
        value = intent.amount.toString();
        tokenSymbol = intent.symbol ?? 'SYSX';
        decimals = intent.decimals ?? 8;
      }
    }

    // Determine transaction type label using unified function
    const finalTokenType = detectedTokenType || tx.tokenType;
    if (finalTokenType && value !== '0') {
      transactionTypeLabel = getSyscoinTransactionTypeLabel(finalTokenType);
    }

    // If we still don't have a proper value but have basic transaction info, use it
    if ((!value || value === '0') && tx.value) {
      // tx.value is in raw satoshis, so we need to format it properly
      const formattedValue = formatSyscoinValue(tx.value.toString(), decimals);
      value = parseFloat(formattedValue).toString();
    }

    // If we have symbol/decimals from transaction metadata, use them
    if (tx.symbol && !metadata.symbol) {
      tokenSymbol = tx.symbol;
    }
    if (tx.decimals !== undefined && !metadata.decimals) {
      decimals = tx.decimals;
    }

    const notification: ITransactionNotification = {
      txHash: tx.txid,
      type,
      from: account.address,
      to: account.address, // UTXO doesn't have simple to/from
      value:
        value && value !== '0'
          ? formatDisplayValue(parseFloat(value), decimals)
          : undefined,
      tokenSymbol,
      network: network.label,
      chainId: network.chainId,
      // Include transaction type in the notification
      transactionType: transactionTypeLabel || undefined,
    } as ITransactionNotification;

    showTransactionNotification(notification);
  }

  // For EVM transactions where value is in wei and needs conversion
  private formatValue(value: string, decimals: number): string {
    try {
      const formattedValue = formatUnits(value, decimals);
      const numValue = parseFloat(formattedValue);
      return numValue.toFixed(4);
    } catch {
      return '0';
    }
  }

  // Public cleanup method
  public cleanup() {
    // Currently no cleanup needed
  }

  // Public methods for manual notification triggering
  public notifyDappConnection(dappUrl: string, approved: boolean) {
    showDappConnectionNotification(dappUrl, approved);
  }

  public notifyError(error: string, context?: string) {
    showErrorNotification(error, context);
  }

  // Public method to update pending transaction badge
  public updatePendingTransactionBadge(transactions: any[]) {
    const pendingCount = transactions.filter(
      (tx) => !isTransactionInBlock(tx)
    ).length;

    updatePendingTransactionBadge(pendingCount);
  }
}

// Export singleton instance
export const notificationManager = new NotificationManager();
