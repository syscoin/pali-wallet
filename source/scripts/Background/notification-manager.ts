import { txUtils } from '@sidhujag/sysweb3-utils';

import { getController, getIsReady } from 'scripts/Background';
import store from 'state/store';
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
interface INotificationState {
  // Last known account
  lastAccount: { address: string; label?: string } | null;
  // Last known network
  lastNetwork: { chainId: number; name: string } | null;
  // Track pending transactions
  pendingTransactions: Map<string, ITransactionNotification>;
  // Track notifications we've already shown
  shownTransactionNotifications: Set<string>;
}

class NotificationManager {
  private state: INotificationState = {
    shownTransactionNotifications: new Set(),
    pendingTransactions: new Map(),
    lastNetwork: null,
    lastAccount: null,
  };

  constructor() {
    // Initialize state with current values to prevent false notifications on startup
    const currentState = store.getState();

    if (currentState.vault) {
      const {
        activeAccount,
        activeNetwork,
        accounts,
        accountTransactions,
        isBitcoinBased,
      } = currentState.vault;

      // Initialize last network
      if (activeNetwork) {
        this.state.lastNetwork = {
          chainId: activeNetwork.chainId,
          name: activeNetwork.label,
        };
      }

      // Initialize last account
      if (activeAccount && accounts) {
        const account = accounts[activeAccount.type]?.[activeAccount.id];
        if (account) {
          this.state.lastAccount = {
            address: account.address,
            label: account.label,
          };
        }
      }

      // Initialize shownTransactionNotifications with existing transactions
      // This prevents showing notifications for transactions that already exist on startup
      if (activeAccount && accountTransactions) {
        const txs = accountTransactions[activeAccount.type]?.[activeAccount.id];
        if (txs) {
          const networkType = isBitcoinBased ? 'syscoin' : 'ethereum';
          const chainTxs = txs[networkType]?.[activeNetwork.chainId] || [];

          chainTxs.forEach((tx: any) => {
            const txId = tx.hash || tx.txid;
            if (txId) {
              const txKey = `${txId}_${activeNetwork.chainId}`;
              // Mark all existing transactions as already shown
              // This prevents spam on startup/restart
              if (!isTransactionInBlock(tx)) {
                this.state.shownTransactionNotifications.add(
                  `${txKey}_pending`
                );
              } else {
                this.state.shownTransactionNotifications.add(
                  `${txKey}_confirmed`
                );
              }
            }
          });
        }
      }
    }

    // Set up notification click handlers
    setupNotificationListeners();

    // Subscribe to state changes
    this.subscribeToStateChanges();

    // Check for pending transactions periodically
    this.startPendingTransactionCheck();
  }

  private subscribeToStateChanges() {
    let previousState = store.getState();

    store.subscribe(() => {
      const currentState = store.getState();
      const { vault } = currentState;

      // Early return if vault doesn't exist
      if (!vault) {
        previousState = currentState;
        return;
      }

      // Check for network changes
      if (vault.activeNetwork && previousState.vault?.activeNetwork) {
        if (
          vault.activeNetwork.chainId !==
          previousState.vault.activeNetwork.chainId
        ) {
          this.handleNetworkChange(
            previousState.vault.activeNetwork,
            vault.activeNetwork
          );
        }
      }
      // Check for account changes
      if (vault.activeAccount && previousState.vault?.activeAccount) {
        // Check if the active account ID or type has changed
        if (
          vault.activeAccount.id !== previousState.vault.activeAccount.id ||
          vault.activeAccount.type !== previousState.vault.activeAccount.type
        ) {
          // Get the newly active account
          const newActiveAccount =
            vault.accounts[vault.activeAccount.type]?.[vault.activeAccount.id];

          if (newActiveAccount) {
            this.handleAccountChange(newActiveAccount);
          }
        }
      }

      // Check for transaction updates
      if (
        previousState.vault?.accountTransactions &&
        vault.accountTransactions !== previousState.vault.accountTransactions
      ) {
        this.checkTransactionUpdates(vault, previousState.vault);
      }

      previousState = currentState;
    });
  }

  private handleNetworkChange(fromNetwork: any, toNetwork: any) {
    // Only show notification if we're actually switching networks
    // Skip notification on initial load (when lastNetwork is null)
    if (
      this.state.lastNetwork &&
      this.state.lastNetwork.chainId !== toNetwork.chainId
    ) {
      showNetworkChangeNotification(fromNetwork.label, toNetwork.label);
    }

    // Always update the last network state
    this.state.lastNetwork = {
      chainId: toNetwork.chainId,
      name: toNetwork.label,
    };
  }

  private handleAccountChange(newAccount: any) {
    // Only show notification if we're switching from one account to another
    // Skip notification on initial load (when lastAccount is null)
    if (
      this.state.lastAccount &&
      this.state.lastAccount.address !== newAccount.address
    ) {
      showAccountChangeNotification(newAccount.address, newAccount.label);
    }

    // Always update the last account state
    this.state.lastAccount = {
      address: newAccount.address,
      label: newAccount.label,
    };
  }

  private checkTransactionUpdates(currentVault: any, previousVault: any) {
    const { activeAccount, activeNetwork, accounts, isBitcoinBased } =
      currentVault;

    if (!activeAccount || !activeNetwork) {
      return;
    }

    const account = accounts[activeAccount.type]?.[activeAccount.id];
    if (!account) {
      return;
    }

    const currentTxs =
      currentVault.accountTransactions[activeAccount.type]?.[activeAccount.id];
    const previousTxs =
      previousVault?.accountTransactions?.[activeAccount.type]?.[
        activeAccount.id
      ];

    // Early return if no current transactions exist for this account
    if (!currentTxs) {
      return;
    }

    if (isBitcoinBased) {
      // Safely access syscoin transactions with proper null checks
      const currentUtxoTxs = currentTxs?.syscoin?.[activeNetwork.chainId] || [];
      const previousUtxoTxs =
        previousTxs?.syscoin?.[activeNetwork.chainId] || [];
      this.checkUtxoTransactions(
        currentUtxoTxs,
        previousUtxoTxs,
        account,
        activeNetwork
      );
    } else {
      // Safely access ethereum transactions with proper null checks
      const currentEvmTxs = currentTxs?.ethereum?.[activeNetwork.chainId] || [];
      const previousEvmTxs =
        previousTxs?.ethereum?.[activeNetwork.chainId] || [];
      this.checkEvmTransactions(
        currentEvmTxs,
        previousEvmTxs,
        account,
        activeNetwork
      );
    }
  }

  // Helper method to create transaction lookup maps
  private createTransactionMaps(transactions: any[]) {
    const byHash = new Map();
    const byNonce = new Map();

    transactions.forEach((tx) => {
      // Map by hash (works for both EVM and UTXO)
      const txId = tx.hash || tx.txid;
      if (txId) {
        byHash.set(txId, tx);
      }

      // Map by nonce (EVM only)
      if (tx.from && typeof tx.nonce === 'number') {
        const nonceKey = `${tx.from.toLowerCase()}_${tx.nonce}`;
        byNonce.set(nonceKey, tx);
      }
    });

    return { byHash, byNonce };
  }

  // Helper method to find previous transaction
  private findPreviousTransaction(
    tx: any,
    previousMaps: { byHash: Map<string, any>; byNonce: Map<string, any> }
  ) {
    const { byHash, byNonce } = previousMaps;

    // First try to find by hash/txid
    const txId = tx.hash || tx.txid;
    const byHashResult = txId ? byHash.get(txId) : null;

    // For EVM transactions, also try to find by nonce (for replacements)
    let byNonceResult = null;
    if (!byHashResult && tx.from && typeof tx.nonce === 'number') {
      const nonceKey = `${tx.from.toLowerCase()}_${tx.nonce}`;
      byNonceResult = byNonce.get(nonceKey);
    }

    return {
      previousTx: byHashResult || byNonceResult,
    };
  }

  // Helper method to handle confirmed transactions
  private handleConfirmedTransaction(
    tx: any,
    previousTx: any,
    account: any,
    network: any,
    isEvm: boolean
  ) {
    const txId = isEvm ? tx.hash : tx.txid;
    const txKey = `${txId}_${network.chainId}`;

    // Check if we've already shown a notification for this transaction
    if (this.state.shownTransactionNotifications.has(`${txKey}_confirmed`)) {
      return;
    }

    // Show the appropriate notification
    if (isEvm) {
      this.showEvmTransactionNotification(tx, 'confirmed', account, network);
    } else {
      this.showUtxoTransactionNotification(tx, 'confirmed', account, network);
    }

    // Mark as shown
    this.state.shownTransactionNotifications.add(`${txKey}_confirmed`);
    this.state.pendingTransactions.delete(txKey);

    // If this was a replacement, also mark the old tx as notified
    const previousTxId = isEvm ? previousTx.hash : previousTx.txid;
    if (previousTxId !== txId) {
      const oldTxKey = `${previousTxId}_${network.chainId}`;
      this.state.shownTransactionNotifications.add(`${oldTxKey}_confirmed`);
      this.state.pendingTransactions.delete(oldTxKey);
    }
  }

  private checkEvmTransactions(
    currentTxs: any[],
    previousTxs: any[],
    account: any,
    network: any
  ) {
    // Create lookup maps for previous transactions
    const previousMaps = this.createTransactionMaps(previousTxs);

    // Check each current transaction
    currentTxs.forEach((tx) => {
      const txKey = `${tx.hash}_${network.chainId}`;
      const { previousTx } = this.findPreviousTransaction(tx, previousMaps);

      // Generic check: A transaction is confirmed if it's in a block
      const isCurrentTxConfirmed = isTransactionInBlock(tx);
      const isPreviousTxConfirmed =
        previousTx && isTransactionInBlock(previousTx);

      // New pending transaction
      if (
        !previousTx &&
        !isCurrentTxConfirmed &&
        !this.state.shownTransactionNotifications.has(`${txKey}_pending`)
      ) {
        this.showEvmTransactionNotification(tx, 'pending', account, network);
        this.state.shownTransactionNotifications.add(`${txKey}_pending`);
      }

      // Transaction just confirmed (including replacements)
      // Check if previous was unconfirmed (no blockNumber) and current is confirmed (has blockNumber)
      if (previousTx && !isPreviousTxConfirmed && isCurrentTxConfirmed) {
        this.handleConfirmedTransaction(tx, previousTx, account, network, true);
      }

      // Failed transaction
      if (
        tx.txreceipt_status === '0' &&
        !this.state.shownTransactionNotifications.has(`${txKey}_failed`)
      ) {
        this.showEvmTransactionNotification(tx, 'failed', account, network);
        this.state.shownTransactionNotifications.add(`${txKey}_failed`);
        this.state.pendingTransactions.delete(txKey);
      }
    });

    // Update pending transaction badge
    this.updatePendingBadge(currentTxs);
  }

  private checkUtxoTransactions(
    currentTxs: any[],
    previousTxs: any[],
    account: any,
    network: any
  ) {
    // Create lookup maps for previous transactions (UTXO only uses hash)
    const previousMaps = this.createTransactionMaps(previousTxs);

    // Track which transactions we've seen in this update
    const currentTxIds = new Set<string>();

    // Check each current transaction
    currentTxs.forEach((tx) => {
      const txKey = `${tx.txid}_${network.chainId}`;
      currentTxIds.add(tx.txid);

      const { previousTx } = this.findPreviousTransaction(tx, previousMaps);

      // Generic check: A transaction is confirmed if it's in a block
      const isCurrentTxConfirmed = isTransactionInBlock(tx);
      const isPreviousTxConfirmed =
        previousTx && isTransactionInBlock(previousTx);

      // New pending transaction - only notify if we haven't seen it before
      if (
        !isCurrentTxConfirmed &&
        !this.state.shownTransactionNotifications.has(`${txKey}_pending`) &&
        !this.state.shownTransactionNotifications.has(`${txKey}_confirmed`)
      ) {
        // Additional check: only show if this is truly a new transaction
        if (!previousTx || previousTxs.length === 0) {
          this.showUtxoTransactionNotification(tx, 'pending', account, network);
          this.state.shownTransactionNotifications.add(`${txKey}_pending`);
        }
      }

      // Transaction just confirmed
      if (
        previousTx &&
        !isPreviousTxConfirmed &&
        isCurrentTxConfirmed &&
        !this.state.shownTransactionNotifications.has(`${txKey}_confirmed`)
      ) {
        this.handleConfirmedTransaction(
          tx,
          previousTx,
          account,
          network,
          false
        );
        this.state.shownTransactionNotifications.add(`${txKey}_confirmed`);
      }
    });

    // Clean up stale entries from shownTransactionNotifications
    const keysToRemove: string[] = [];
    this.state.shownTransactionNotifications.forEach((key) => {
      const [txId] = key.split('_');
      if (!currentTxIds.has(txId)) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach((key) => {
      this.state.shownTransactionNotifications.delete(key);
    });

    // Update pending transaction badge
    this.updatePendingBadge(currentTxs);
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
        undefined, // tokenCache
        false, // skipUnknownTokenFetch
        getController() // Pass controller for background context
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

      if (type === 'pending') {
        this.state.pendingTransactions.set(`${tx.hash}_${network.chainId}`, {
          ...notification,
          timestamp: Date.now(),
        } as any);
      }
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

      if (type === 'pending') {
        this.state.pendingTransactions.set(
          `${tx.hash}_${network.chainId}`,
          notification
        );
      }
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
          if (!getIsReady()) {
            console.warn(
              '[NotificationManager] Controller not ready yet for transaction decoding'
            );
          } else {
            const controller = getController();

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

    if (type === 'pending') {
      this.state.pendingTransactions.set(`${tx.txid}_${network.chainId}`, {
        ...notification,
        timestamp: Date.now(),
      } as any);
    }
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

  private updatePendingBadge(transactions: any[]) {
    const pendingCount = transactions.filter(
      (tx) => !isTransactionInBlock(tx)
    ).length;

    updatePendingTransactionBadge(pendingCount);
  }

  private pendingCheckInterval: NodeJS.Timeout | null = null;

  private startPendingTransactionCheck() {
    // Clear any existing interval to prevent duplicates
    if (this.pendingCheckInterval) {
      clearInterval(this.pendingCheckInterval);
    }

    // Check every 30 seconds for stuck pending transactions
    this.pendingCheckInterval = setInterval(() => {
      const now = Date.now();
      const TIMEOUT = 10 * 60 * 1000; // 10 minutes

      this.state.pendingTransactions.forEach((notification, key) => {
        // If a pending transaction has been pending for too long, remove it
        // This prevents memory leaks from stuck transactions
        if (now - (notification as any).timestamp > TIMEOUT) {
          this.state.pendingTransactions.delete(key);
        }
      });
    }, 30000);
  }

  // Public cleanup method
  public cleanup() {
    if (this.pendingCheckInterval) {
      clearInterval(this.pendingCheckInterval);
      this.pendingCheckInterval = null;
    }
  }

  // Public methods for manual notification triggering
  public notifyDappConnection(dappUrl: string, approved: boolean) {
    showDappConnectionNotification(dappUrl, approved);
  }

  public notifyError(error: string, context?: string) {
    showErrorNotification(error, context);
  }

  // Clear all notification state (useful for wallet lock/reset)
  public clearState(preservePendingTransactions = false) {
    this.state.shownTransactionNotifications.clear();

    // Only clear pending transactions if explicitly requested
    // This allows us to keep tracking pending transactions when wallet is locked
    if (!preservePendingTransactions) {
      this.state.pendingTransactions.clear();
      updatePendingTransactionBadge(0);
    } else {
      // Keep the badge count updated with current pending transactions
      updatePendingTransactionBadge(this.state.pendingTransactions.size);
    }
  }

  // Get SPT metadata including any color information
  private async getSPTMetadata(
    assetGuid: string,
    networkUrl: string
  ): Promise<any | null> {
    try {
      // Check if controller is ready
      if (!getIsReady()) {
        console.error(
          '[NotificationManager] Controller not ready yet for asset metadata fetch'
        );
        return null;
      }

      const controller = getController();

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
