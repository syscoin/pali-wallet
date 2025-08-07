import { formatUnits } from '@ethersproject/units';

import { getIsReady } from 'scripts/Background';
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
  private controller: any = null; // Will be set after initialization

  constructor() {
    // Set up notification click handlers
    setupNotificationListeners();
  }

  // Set the controller after it's been initialized
  public setController(controller: any) {
    this.controller = controller;
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
      // Check if controller is ready before proceeding
      if (!getIsReady() || !this.controller) {
        console.warn(
          '[NotificationManager] Controller not ready, skipping EVM transaction notification for:',
          tx.hash
        );
        return;
      }

      // Use the shared utility to get transaction display info
      const displayInfo = await getTransactionDisplayInfo(
        tx,
        network.currency,
        undefined, // tokenCache
        false, // skipUnknownTokenFetch
        this.controller // Pass controller for background context
      );
      // Note: We don't skip token fetch here as notifications should show proper token info

      let value: string | undefined;
      const tokenSymbol = displayInfo.displaySymbol;

      // Format the value appropriately for notifications
      if (displayInfo.isNft) {
        // For NFTs, the displayValue already contains the formatted string
        value = displayInfo.displayValue as string;
      } else {
        // For regular tokens and native currency
        if (typeof displayInfo.displayValue === 'number') {
          value =
            displayInfo.displayValue > 0
              ? displayInfo.displayValue.toFixed(4)
              : undefined;
        } else {
          value = displayInfo.displayValue;
        }
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

        // Get decimals and symbol from tokenTransfers if available
        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
          // Find the transfer that matches the intent asset
          const matchingTransfer = tx.tokenTransfers.find(
            (transfer: any) => transfer.token === intent.assetGuid
          );

          if (matchingTransfer) {
            tokenSymbol =
              matchingTransfer.symbol || network.currency.toUpperCase();
            decimals = matchingTransfer.decimals || 8;
          } else {
            // Fallback to first transfer if no exact match
            const transfer = tx.tokenTransfers[0];
            tokenSymbol = transfer.symbol || network.currency.toUpperCase();
            decimals = transfer.decimals || 8;
          }
        } else {
          // Fallback: hardcoded values for known transaction types
          if (
            detectedTokenType === 'SPTSyscoinBurnToAssetAllocation' ||
            detectedTokenType === 'SPTSyscoinBurnToAssetAllocation'
          ) {
            tokenSymbol = 'SYSX';
            decimals = 8;
          }
        }
      }
    }

    // Determine transaction type label using unified function
    const finalTokenType = detectedTokenType || tx.tokenType;
    if (finalTokenType) {
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
