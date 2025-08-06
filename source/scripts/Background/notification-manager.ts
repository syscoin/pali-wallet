import { txUtils } from '@sidhujag/sysweb3-utils';

import { getIsReady } from 'scripts/Background';
import { INetwork } from 'types/network';
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
    let metadata: any = {};
    let transactionTypeLabel = '';
    let decodedTx: any = null;
    let detectedTokenType: string | null = null;

    // Try to decode the transaction to get full SPT details
    if (tx.hex || tx.txid) {
      try {
        let rawHex: string | null = null;

        // If we have the hex, use it directly
        if (tx.hex) {
          rawHex = tx.hex;
        }
        // Otherwise, fetch the raw transaction first
        else if (tx.txid && network.url) {
          const { getRawTransaction } = txUtils();
          const rawTx = await getRawTransaction(network.url, tx.txid);
          if (rawTx && typeof rawTx === 'string') {
            rawHex = rawTx;
          }
        }

        // Decode the raw hex to get SPT information
        if (rawHex) {
          // Check if controller is ready
          if (!getIsReady() || !this.controller) {
            console.warn(
              '[NotificationManager] Controller not ready yet for transaction decoding'
            );
          } else {
            const controller = this.controller;

            if (controller && controller.wallet) {
              try {
                // Use the enhanced decodeRawTransaction method with isRawHex=true
                decodedTx = controller.wallet.decodeRawTransaction(
                  rawHex,
                  true
                );
              } catch (err) {
                console.error(
                  '[NotificationManager] Failed to decode transaction:',
                  err
                );
                // Continue with regular processing
              }
            } else {
              console.warn(
                '[NotificationManager] Controller or wallet not available for transaction decoding'
              );
            }
          }
        }

        // Extract SPT asset information from decoded transaction
        if (decodedTx?.syscoin) {
          // Get transaction type directly from decoded transaction
          if (decodedTx.syscoin.txtype) {
            detectedTokenType = decodedTx.syscoin.txtype;
          }

          // Handle asset allocations (for SPT transfers)
          if (decodedTx.syscoin.allocations?.assets) {
            const assets = decodedTx.syscoin.allocations.assets;
            if (assets.length > 0) {
              const asset = assets[0];

              // Use the formatted value if available, otherwise calculate from values array
              if (asset.values && asset.values.length > 0) {
                const totalValue = asset.values.reduce(
                  (sum: number, val: any) => {
                    // Use valueFormatted if available (already in correct decimal format)
                    if (val.valueFormatted) {
                      return sum + parseFloat(val.valueFormatted);
                    }
                    // Otherwise convert from satoshis
                    return sum + (val.value || 0);
                  },
                  0
                );

                // If we got formatted values, use them directly
                if (asset.values[0].valueFormatted) {
                  value = totalValue.toString();
                } else {
                  // Convert from satoshis to token units
                  value = totalValue.toString();
                }
              }

              // Fetch asset metadata
              if (asset.assetGuid && network.url) {
                const assetData = await this.getSPTMetadata(
                  asset.assetGuid.toString(),
                  network.url
                );
                if (assetData) {
                  tokenSymbol = assetData.symbol;
                  decimals = assetData.decimals;
                  metadata = {
                    ...assetData.metaData,
                    assetGuid: asset.assetGuid.toString(),
                  };
                }
              }
            }
          }

          // Handle burns (SYS → SYSX, SYSX → SYS, Bridge to NEVM)
          if (decodedTx.syscoin.burn) {
            const burn = decodedTx.syscoin.burn;

            // For burns, the amount might be in the burn object or we need to calculate from outputs
            if (burn.amount) {
              value = burn.amount.toString();
            }

            // Check if burning to Ethereum (bridge transaction)
            if (burn.ethaddress) {
              // This is a bridge transaction to NEVM
              detectedTokenType = 'assetallocationburntoethereum';
            }
          }

          // Handle mints (from NEVM)
          if (decodedTx.syscoin.mint) {
            const mint = decodedTx.syscoin.mint;

            if (mint.amount) {
              value = mint.amount.toString();
            }

            // This is a mint from NEVM transaction
            detectedTokenType = 'assetallocationmint';
          }
        }
      } catch (error) {
        console.error(
          '[NotificationManager] Failed to decode transaction:',
          error
        );
        // Continue with regular processing
      }
    }

    // Determine transaction type label
    const finalTokenType = detectedTokenType || tx.tokenType;
    if (finalTokenType) {
      switch (finalTokenType) {
        case 'assetallocationsend':
          transactionTypeLabel = 'SPT Transfer';
          break;

        case 'syscoinburntoallocation':
          transactionTypeLabel = 'SYS → SYSX';
          tokenSymbol = 'SYS'; // Source is SYS
          break;

        case 'assetallocationburntosyscoin':
          transactionTypeLabel = 'SYSX → SYS';
          tokenSymbol = 'SYSX'; // Source is SYSX
          break;

        case 'assetallocationburntoethereum':
          transactionTypeLabel = 'Bridge to NEVM';
          break;

        case 'assetallocationmint':
          transactionTypeLabel = 'Mint from NEVM';
          break;

        default:
          // Regular SYS transaction
          break;
      }
    }

    // If we still don't have a proper value but have basic transaction info, use it
    if ((!value || value === '0') && tx.value) {
      value = tx.value;
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
        value && value !== '0' ? this.formatValue(value, decimals) : undefined,
      tokenSymbol,
      network: network.label,
      chainId: network.chainId,
      // Include transaction type in the notification
      transactionType: transactionTypeLabel || undefined,
      metadata, // Include metadata for SPT color/visual info
    } as ITransactionNotification;

    showTransactionNotification(notification);
  }

  private formatValue(value: string, decimals: number): string {
    try {
      const divisor = Math.pow(10, decimals);
      const numValue = parseFloat(value) / divisor;
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

  // Get SPT metadata including any color information
  private async getSPTMetadata(
    assetGuid: string,
    networkUrl: string
  ): Promise<any | null> {
    try {
      // Check if controller is ready
      if (!getIsReady() || !this.controller) {
        console.warn(
          '[NotificationManager] Controller not ready yet for asset metadata fetch'
        );
        return null;
      }

      const controller = this.controller;

      if (!controller || !controller.wallet) {
        console.error(
          '[NotificationManager] Controller or wallet not available'
        );
        return null;
      }

      const assetData = await controller.wallet.getSysAssetMetadata(
        assetGuid,
        networkUrl
      );
      if (assetData) {
        const metadata = {
          symbol: assetData.symbol,
          decimals: assetData.decimals,
          metaData: assetData.metaData, // This could contain color or other visual info
        };
        return metadata;
      }
    } catch (error) {
      console.error(
        '[NotificationManager] Failed to fetch SPT metadata:',
        error
      );
    }

    return null;
  }
}

// Export singleton instance
export const notificationManager = new NotificationManager();
