import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';
import { ethers } from 'ethers';
import { isInteger, omit } from 'lodash';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import store from 'state/store';
import { ITokenDetails } from 'types/tokens';
import { ITransactionParams, ITxState } from 'types/transactions';

import { formatCurrency, truncate } from './format';

/**
 * Get proper display information for a transaction (value, symbol, recipient, and type)
 * Uses the same logic as notification manager for consistent display
 * @param tx Transaction object
 * @param currency Network currency (e.g., 'ETH', 'NEVM')
 * @param tokenCache Cache of known token info by contract address
 * @returns Object with displayValue, displaySymbol, isErc20Transfer, actualRecipient, isNft, and hasUnknownDecimals
 */
export const getTransactionDisplayInfo = async (
  tx: any,
  currency: string,
  tokenCache?: Map<
    string,
    {
      decimals: number;
      isNft: boolean;
      symbol: string;
    }
  >
): Promise<{
  actualRecipient: string;
  displaySymbol: string;
  displayValue: number | string;
  hasUnknownDecimals?: boolean;
  isErc20Transfer: boolean;
  isNft: boolean;
}> => {
  const isErc20Tx = isERC20Transfer(tx);

  if (isErc20Tx) {
    // This is an ERC-20/ERC-721/ERC-1155 transfer
    const tokenValue = getERC20TransferValue(tx);
    const tokenAddress = tx.to; // The 'to' address is the token contract for ERC20 transfers
    const actualRecipient = getERC20Recipient(tx); // Extract the actual recipient from input data

    if (tokenValue && tokenAddress) {
      // First check enhanced cache for this contract address
      const cachedToken = tokenCache?.get(tokenAddress.toLowerCase());
      if (cachedToken) {
        const { symbol, decimals, isNft } = cachedToken;

        if (isNft) {
          // For NFTs, show count instead of formatted value
          const nftCount = Number(tokenValue);
          return {
            displayValue: `${nftCount} NFT${nftCount !== 1 ? 's' : ''}`,
            displaySymbol: symbol.toUpperCase(),
            isErc20Transfer: true,
            actualRecipient: actualRecipient || tokenAddress,
            isNft: true,
          };
        } else {
          // Regular ERC-20 token with known decimals
          return {
            displayValue: Number(tokenValue) / Math.pow(10, decimals),
            displaySymbol: symbol.toUpperCase(),
            isErc20Transfer: true,
            actualRecipient: actualRecipient || tokenAddress,
            isNft: false,
          };
        }
      }

      // Try to get token info from user's assets or fetch from controller
      try {
        const { accounts, activeAccount, accountAssets } =
          store.getState().vault;
        const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
        const userAssets =
          accountAssets[activeAccount.type]?.[activeAccount.id];

        // Check user's account assets first (fastest)
        if (userAssets?.ethereum) {
          const token = userAssets.ethereum.find(
            (asset) =>
              asset.contractAddress?.toLowerCase() ===
              tokenAddress.toLowerCase()
          );

          if (token) {
            const isNft = token.isNft || false;
            const decimals = Number(token.decimals) || (isNft ? 0 : 18);

            if (isNft) {
              // For NFTs, show count instead of formatted value
              const nftCount = Number(tokenValue);
              return {
                displayValue: `${nftCount} NFT${nftCount !== 1 ? 's' : ''}`,
                displaySymbol: token.tokenSymbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: true,
              };
            } else {
              // Regular ERC-20 token
              return {
                displayValue: Number(tokenValue) / Math.pow(10, decimals),
                displaySymbol: token.tokenSymbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: false,
              };
            }
          }
        }

        // If not in user's assets, try to fetch from controller
        try {
          const tokenDetails = (await controllerEmitter(
            ['wallet', 'getTokenDetails'],
            [tokenAddress, currentAccount?.address]
          )) as ITokenDetails | null;

          if (tokenDetails) {
            const isNft = tokenDetails.isNft || false;
            const decimals = isNft ? 0 : tokenDetails.decimals || 18;

            if (isNft) {
              // For NFTs, show count instead of formatted value
              const nftCount = Number(tokenValue);
              return {
                displayValue: `${nftCount} NFT${nftCount !== 1 ? 's' : ''}`,
                displaySymbol: tokenDetails.symbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: true,
              };
            } else {
              // Regular ERC-20 token
              return {
                displayValue: Number(tokenValue) / Math.pow(10, decimals),
                displaySymbol: tokenDetails.symbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: false,
              };
            }
          }
        } catch (controllerError) {
          console.warn('Controller token lookup failed:', controllerError);
        }
      } catch (error) {
        console.error('Error getting token info:', error);
      }

      // Fallback: show raw value with truncated contract address as symbol
      // Since we don't know if it's an NFT or the decimals, flag it
      return {
        displayValue: tokenValue.toString(), // Keep as raw value since decimals unknown
        displaySymbol: `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(
          -4
        )}`,
        isErc20Transfer: true,
        actualRecipient: actualRecipient || tokenAddress,
        isNft: false,
        hasUnknownDecimals: true, // Flag that we don't know the decimals
      };
    }
  }

  // Native currency transaction
  const rawValue = tx.value;
  let numericValue = 0;

  if (typeof rawValue === 'string') {
    if (rawValue.startsWith('0x')) {
      numericValue = parseInt(rawValue, 16) / 1e18;
    } else {
      numericValue = Number(rawValue) / 1e18;
    }
  } else if (rawValue?.hex) {
    numericValue = parseInt(rawValue.hex, 16) / 1e18;
  } else if ((rawValue as any)?._hex) {
    numericValue = parseInt((rawValue as any)._hex, 16) / 1e18;
  } else if (typeof rawValue === 'number') {
    numericValue = rawValue / 1e18;
  }

  return {
    displayValue: numericValue,
    displaySymbol: currency.toUpperCase(),
    isErc20Transfer: false,
    actualRecipient: tx.to || '', // For native transfers, tx.to is the actual recipient
    isNft: false,
  };
};

export const getAssetBalance = (
  asset: any,
  activeAccount: IKeyringAccountState,
  isBitcoinBased: boolean,
  activeNetwork: { currency: string }
) => {
  if (!isBitcoinBased) {
    const networkCurrency = activeNetwork.currency.toLowerCase();
    const value = Number(
      asset.tokenSymbol?.toLowerCase() === networkCurrency
        ? activeAccount.balances.ethereum
        : asset.balance
    );

    return `${isInteger(value) ? value : value.toFixed(2)} ${
      asset.tokenSymbol
    }`;
  }

  const formattedBalance = truncate(
    formatCurrency(String(+asset.balance), asset.decimals),
    14
  );

  return `${formattedBalance} ${asset.symbol}`;
};

export const omitTransactionObjectData = (
  transaction: ITxState | ITransactionParams,
  omitArray: Array<string>
) => omit(transaction, omitArray);

// eslint-disable-next-line no-shadow
export enum UpdateTxAction {
  Cancel = 'cancel',
  SpeedUp = 'speedUp',
}

const cancelTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  alert: any,
  t: (key: string) => string
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.cancelNotAvailableUtxo'));
    return;
  }

  try {
    const response = await controllerEmitter(
      ['wallet', 'ethereumTransaction', 'cancelSentTransaction'],
      [txHash, isLegacy]
    );

    if (!response) {
      alert.error(t('transactions.transactionCancelFailed'));
      return;
    }

    const { isCanceled, error } = response as {
      error: boolean;
      isCanceled: boolean;
    };

    if (!isCanceled && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isCanceled) {
      case true:
        await controllerEmitter(
          ['wallet', 'setEvmTransactionAsCanceled'],
          [txHash, chainId]
        );

        alert.success(t('transactions.transactionCanceledSuccessfully'));
        break;
      case false:
        alert.error(t('transactions.transactionCancelFailed'));
        break;
    }
  } catch (error) {
    console.error('Error cancelling transaction:', error);

    alert.error(t('transactions.transactionCancelFailed'));
  }
};

const speedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  alert: any,
  t: (key: string) => string
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.speedUpNotAvailableUtxo'));
    return;
  }

  try {
    const response = await controllerEmitter(
      ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
      [txHash, isLegacy]
    );

    if (!response) {
      alert.error(t('transactions.transactionSpeedUpFailed'));
      return;
    }

    const { isSpeedUp, error, transaction } = response as {
      error: boolean;
      isSpeedUp: boolean;
      transaction: IEvmTransactionResponse;
    };

    if (!isSpeedUp && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isSpeedUp) {
      case true:
        await controllerEmitter(
          ['wallet', 'setEvmTransactionAsAccelerated'],
          [txHash, chainId, transaction]
        );

        alert.success(t('transactions.transactionAcceleratedSuccessfully'));
        break;
      case false:
        alert.error(t('transactions.transactionSpeedUpFailed'));
        break;
    }
  } catch (error) {
    console.error('Error speeding up transaction:', error);

    alert.error(t('transactions.transactionSpeedUpFailed'));
  }
};

export const handleUpdateTransaction = async ({
  updateData,
  t,
}: {
  t: (key: string) => string;
  updateData: {
    alert: any;
    chainId: number;
    isLegacy: boolean;
    txHash: string;
    updateType: UpdateTxAction;
  };
}) => {
  const { alert, chainId, isLegacy, txHash, updateType } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(txHash, isLegacy, chainId, alert, t);
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(txHash, isLegacy, chainId, alert, t);
  }
};

export const isERC1155Transfer = (tx: IEvmTransactionResponse) => {
  const safeTransferFromSelector = ethers.utils
    .id('safeTransferFrom(address,address,uint256,uint256,bytes)')
    .slice(0, 10);

  if (tx?.input) {
    return tx.input.startsWith(safeTransferFromSelector);
  }

  return false;
};

export const isERC20Transfer = (tx: IEvmTransactionResponse) => {
  const transferSelector = ethers.utils
    .id('transfer(address,uint256)')
    .slice(0, 10);
  const transferFromSelector = ethers.utils
    .id('transferFrom(address,address,uint256)')
    .slice(0, 10);

  if (tx?.input) {
    return (
      tx.input.startsWith(transferSelector) ||
      tx.input.startsWith(transferFromSelector)
    );
  }

  return false;
};

export const isTokenTransfer = (tx: IEvmTransactionResponse) =>
  isERC20Transfer(tx) || isERC1155Transfer(tx);

export const getERC20TransferValue = (tx: IEvmTransactionResponse) => {
  const transferMethodSignature = ethers.utils
    .id('transfer(address,uint256)')
    .slice(0, 10);
  const transferFromMethodSignature = ethers.utils
    .id('transferFrom(address,address,uint256)')
    .slice(0, 10);

  if (tx?.input) {
    if (tx.input.startsWith(transferMethodSignature)) {
      const decodedInput = ethers.utils.defaultAbiCoder.decode(
        ['address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[1]; // the second element is the value transferred
    } else if (tx.input.startsWith(transferFromMethodSignature)) {
      const decodedInput = ethers.utils.defaultAbiCoder.decode(
        ['address', 'address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2]; // the third element is the value transferred
    }
  }

  return null; // return null if the transaction is not a token transfer
};

export const getERC20Recipient = (
  tx: IEvmTransactionResponse
): string | null => {
  const transferMethodSignature = ethers.utils
    .id('transfer(address,uint256)')
    .slice(0, 10);
  const transferFromMethodSignature = ethers.utils
    .id('transferFrom(address,address,uint256)')
    .slice(0, 10);

  if (tx?.input) {
    try {
      if (tx.input.startsWith(transferMethodSignature)) {
        const decodedInput = ethers.utils.defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[0]; // the first element is the recipient
      } else if (tx.input.startsWith(transferFromMethodSignature)) {
        const decodedInput = ethers.utils.defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[1]; // the second element is the recipient
      }
    } catch (error) {
      console.error('Error parsing ERC20 recipient:', error);
    }
  }

  return null; // return null if the transaction is not a token transfer
};
