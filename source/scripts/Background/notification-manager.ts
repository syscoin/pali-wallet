import { getAsset } from '@pollum-io/sysweb3-utils';

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
import { isERC20Transfer, getERC20TransferValue } from 'utils/transactions';
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
  // Cache for token lookups to avoid repeated API calls
  tokenCache: Map<string, { decimals: number; metadata?: any; symbol: string }>;
}

class NotificationManager {
  private state: INotificationState = {
    shownTransactionNotifications: new Set(),
    pendingTransactions: new Map(),
    lastNetwork: null,
    lastAccount: null,
    tokenCache: new Map(),
  };

  constructor() {
    // Initialize state with current values to prevent false notifications on startup
    const currentState = store.getState();

    if (currentState.vault) {
      const { activeAccount, activeNetwork, accounts } = currentState.vault;

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

      // Check for network changes
      if (vault.activeNetwork && previousState.vault.activeNetwork) {
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
      if (vault.activeAccount && previousState.vault.activeAccount) {
        const currentAccount =
          vault.accounts[vault.activeAccount.type]?.[vault.activeAccount.id];
        const previousAccount =
          previousState.vault.accounts[
            previousState.vault.activeAccount.type
          ]?.[previousState.vault.activeAccount.id];

        if (
          currentAccount &&
          previousAccount &&
          currentAccount.address !== previousAccount.address
        ) {
          this.handleAccountChange(currentAccount);
        }
      }

      // Check for transaction updates
      if (
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
      previousVault.accountTransactions[activeAccount.type]?.[activeAccount.id];

    if (!currentTxs) {
      return;
    }

    if (isBitcoinBased) {
      const currentUtxoTxs = currentTxs.syscoin?.[activeNetwork.chainId] || [];
      const previousUtxoTxs =
        previousTxs?.syscoin?.[activeNetwork.chainId] || [];
      this.checkUtxoTransactions(
        currentUtxoTxs,
        previousUtxoTxs,
        account,
        activeNetwork
      );
    } else {
      const currentEvmTxs = currentTxs.ethereum?.[activeNetwork.chainId] || [];
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

    // Check each current transaction
    currentTxs.forEach((tx) => {
      const txKey = `${tx.txid}_${network.chainId}`;
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
        this.showUtxoTransactionNotification(tx, 'pending', account, network);
        this.state.shownTransactionNotifications.add(`${txKey}_pending`);
      }

      // Transaction just confirmed
      if (previousTx && !isPreviousTxConfirmed && isCurrentTxConfirmed) {
        this.handleConfirmedTransaction(
          tx,
          previousTx,
          account,
          network,
          false
        );
      }
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
    let value: string | undefined;
    let tokenSymbol = network.currency.toUpperCase();
    let tokenDecimals = 18; // Default for ETH/native tokens

    // Check if this is an ERC20 transfer
    const isErc20 = isERC20Transfer(tx as any);

    if (isErc20) {
      // Extract token information from the transaction
      const tokenValue = getERC20TransferValue(tx as any);
      const tokenAddress = tx.to; // The 'to' address is the token contract for ERC20 transfers

      if (tokenValue && tokenAddress) {
        // Try to get token info from cache or user's token list
        const tokenInfo = await this.getTokenInfo(
          tokenAddress,
          account,
          network
        );

        if (tokenInfo) {
          tokenSymbol = tokenInfo.symbol;
          tokenDecimals = tokenInfo.decimals;
          value = this.formatValue(tokenValue.toString(), tokenDecimals);
        } else {
          // Fallback: show raw value with contract address
          value = this.formatValue(tokenValue.toString(), 18);
          tokenSymbol = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(
            -4
          )}`;
        }
      }
    } else {
      // Native currency transaction
      value = tx.value ? this.formatValue(tx.value.toString(), 18) : undefined;
    }

    const notification: ITransactionNotification = {
      txHash: tx.hash,
      type,
      from: tx.from || account.address,
      to: isErc20 ? this.getERC20Recipient(tx as any) : tx.to,
      value,
      tokenSymbol,
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
          const { txUtils } = await import('@pollum-io/sysweb3-utils');
          const { getRawTransaction } = txUtils();
          const rawTx = await getRawTransaction(network.url, tx.txid);
          if (rawTx && typeof rawTx === 'string') {
            rawHex = rawTx;
          }
        }

        // Decode the raw hex to get SPT information
        if (rawHex) {
          const { getController } = await import('./index');
          const controller = getController();

          if (controller && controller.wallet.isUnlocked()) {
            try {
              // We need to parse the hex into a transaction object first
              // The syscoinjs-lib decodeRawTransaction expects a transaction object with .ins and .outs
              // We can access bitcoinjs through syscoinjs utils
              const syscoinjs = await import('syscoinjs-lib');

              if (syscoinjs.utils && syscoinjs.utils.bitcoinjs) {
                // Parse hex to transaction object using bitcoinjs
                const bitcoinTx =
                  syscoinjs.utils.bitcoinjs.Transaction.fromHex(rawHex);

                // Now decode using MainController's decodeRawTransaction which uses syscoinjs
                decodedTx = controller.wallet.decodeRawTransaction(bitcoinTx);
              } else {
                // Fallback: try with just the raw hex and let it handle parsing
                decodedTx = controller.wallet.decodeRawTransaction({
                  hex: rawHex,
                });
              }
            } catch (err) {
              console.error(
                '[NotificationManager] Failed to decode transaction:',
                err
              );
              // Continue with regular processing
            }
          }
        }

        // Extract SPT asset information from decoded transaction
        if (decodedTx?.syscoin) {
          // Get transaction type
          if (decodedTx.syscoin.txtype) {
            tx.tokenType = decodedTx.syscoin.txtype;
          }

          // Extract asset allocations
          if (decodedTx.syscoin.allocations?.length > 0) {
            const allocation = decodedTx.syscoin.allocations[0];

            // For asset allocation send
            if (allocation.assets && allocation.assets.length > 0) {
              const asset = allocation.assets[0];

              // Calculate total value from all outputs
              let totalValue = 0;
              if (asset.values && asset.values.length > 0) {
                // Alternative structure
                totalValue = asset.values.reduce(
                  (sum: number, val: any) => sum + (val.value || val || 0),
                  0
                );
              }

              if (totalValue > 0) {
                value = totalValue.toString();
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

          // Handle specific syscoin transaction types
          if (decodedTx.syscoin.burns?.length > 0) {
            const burn = decodedTx.syscoin.burns[0];
            if (burn.assetGuid && burn.amount) {
              value = burn.amount.toString();

              // Check if it's SYSX (assetGuid 123456)
              const sysxGuid = '123456';
              if (burn.assetGuid.toString() === sysxGuid) {
                tokenSymbol = 'SYSX';
              } else if (network.url) {
                // Fetch other asset info
                const assetData = await this.getSPTMetadata(
                  burn.assetGuid.toString(),
                  network.url
                );
                if (assetData) {
                  tokenSymbol = assetData.symbol;
                  decimals = assetData.decimals;
                }
              }
            }
          }

          // Handle mints
          if (decodedTx.syscoin.mints?.length > 0) {
            const mint = decodedTx.syscoin.mints[0];
            if (mint.assetGuid && mint.amount) {
              value = mint.amount.toString();

              const sysxGuid = '123456';
              if (mint.assetGuid.toString() === sysxGuid) {
                tokenSymbol = 'SYSX';
              } else if (network.url) {
                // Fetch other asset info
                const assetData = await this.getSPTMetadata(
                  mint.assetGuid.toString(),
                  network.url
                );
                if (assetData) {
                  tokenSymbol = assetData.symbol;
                  decimals = assetData.decimals;
                }
              }
            }
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
    if (tx.tokenType) {
      switch (tx.tokenType) {
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
      this.state.pendingTransactions.set(
        `${tx.txid}_${network.chainId}`,
        notification
      );
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

  private startPendingTransactionCheck() {
    // Check every 30 seconds for stuck pending transactions
    setInterval(() => {
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

  // Get token info from user's token list or cache
  private async getTokenInfo(
    contractAddress: string,
    account: any,
    network: any
  ): Promise<{ decimals: number; symbol: string } | null> {
    // Check cache first
    const cacheKey = `${contractAddress}_${network.chainId}`;
    if (this.state.tokenCache.has(cacheKey)) {
      return this.state.tokenCache.get(cacheKey)!;
    }

    try {
      // Check user's account assets
      const { accountAssets } = store.getState().vault;
      const userAssets = accountAssets[account.type]?.[account.id];

      if (userAssets?.ethereum) {
        const token = userAssets.ethereum.find(
          (asset) =>
            asset.contractAddress?.toLowerCase() ===
            contractAddress.toLowerCase()
        );

        if (token) {
          const tokenInfo = {
            symbol: token.tokenSymbol,
            decimals: Number(token.decimals) || 18,
          };
          this.state.tokenCache.set(cacheKey, tokenInfo);
          return tokenInfo;
        }
      }

      // Check global coin list
      const { coins } = store.getState().price;
      const globalToken =
        coins && Array.isArray(coins)
          ? coins.find((coin: any) =>
              Object.values(coin?.platforms || {})
                ?.map((addr) => `${addr}`.toLowerCase())
                ?.includes(contractAddress.toLowerCase())
            )
          : null;

      if (globalToken) {
        const tokenInfo = {
          symbol: globalToken.symbol.toUpperCase(),
          decimals: 18, // Default, as coingecko doesn't provide decimals
        };
        this.state.tokenCache.set(cacheKey, tokenInfo);
        return tokenInfo;
      }
    } catch (error) {
      console.error('[NotificationManager] Error getting token info:', error);
    }

    return null;
  }

  // Get the actual recipient of an ERC20 transfer
  private getERC20Recipient(tx: any): string | undefined {
    if (!tx.input) return undefined;

    try {
      // For transfer(address,uint256), recipient is the first parameter
      const transferMethodId = '0xa9059cbb';
      // For transferFrom(address,address,uint256), recipient is the second parameter
      const transferFromMethodId = '0x23b872dd';

      if (tx.input.startsWith(transferMethodId)) {
        // Extract recipient address (first 32 bytes after method id)
        const recipientHex = '0x' + tx.input.slice(10, 74);
        // Remove leading zeros and add 0x prefix
        return '0x' + recipientHex.slice(-40);
      } else if (tx.input.startsWith(transferFromMethodId)) {
        // Extract recipient address (second 32 bytes after method id)
        const recipientHex = '0x' + tx.input.slice(74, 138);
        // Remove leading zeros and add 0x prefix
        return '0x' + recipientHex.slice(-40);
      }
    } catch (error) {
      console.error(
        '[NotificationManager] Error parsing ERC20 recipient:',
        error
      );
    }

    return tx.to;
  }

  // Get SPT metadata including any color information
  private async getSPTMetadata(
    assetGuid: string,
    networkUrl: string
  ): Promise<any | null> {
    // Check cache first
    const cacheKey = `spt_${assetGuid}`;
    if (this.state.tokenCache.has(cacheKey)) {
      return this.state.tokenCache.get(cacheKey)!;
    }

    try {
      const assetData = await getAsset(networkUrl, assetGuid);
      if (assetData) {
        const metadata = {
          symbol: assetData.symbol,
          decimals: assetData.decimals,
          metaData: assetData.metaData, // This could contain color or other visual info
        };
        this.state.tokenCache.set(cacheKey, metadata);
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
