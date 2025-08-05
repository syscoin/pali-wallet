import { defaultAbiCoder } from '@ethersproject/abi';
import { id } from '@ethersproject/hash';
import { omit } from 'lodash';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import store from 'state/store';
import { IKeyringAccountState } from 'types/network';
import { ITokenDetails } from 'types/tokens';
import { ITransactionParams, ITxState } from 'types/transactions';

import { formatCurrency, truncate, formatFullPrecisionBalance } from './format';

/**
 * Get proper display information for a transaction (value, symbol, recipient, and type)
 * Uses the same logic as notification manager for consistent display
 * @param tx Transaction object
 * @param currency Network currency (e.g., 'ETH', 'NEVM')
 * @param tokenCache Cache of known token info by contract address
 * @param skipUnknownTokenFetch New parameter to skip fetching unknown tokens
 * @param controller Optional controller instance for background context calls
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
  >,
  skipUnknownTokenFetch = false, // New parameter to skip fetching unknown tokens
  controller?: any
): Promise<{
  actualRecipient: string;
  displaySymbol: string;
  displayValue: number | string;
  hasUnknownDecimals?: boolean;
  isErc20Transfer: boolean; // Note: This includes all token transfers (ERC20/721/1155), not just ERC20
  isNft: boolean;
  tokenId?: string; // Token ID for NFTs
}> => {
  const isTokenTx = isTokenTransfer(tx);

  if (isTokenTx) {
    // This is an ERC-20/ERC-721/ERC-1155 transfer
    const isErc1155Tx = isERC1155Transfer(tx);
    const tokenValue = isErc1155Tx
      ? getERC1155TransferValue(tx)
      : getERC20TransferValue(tx);
    const tokenAddress = tx.to; // The 'to' address is the token contract for token transfers
    const actualRecipient = isErc1155Tx
      ? getERC1155Recipient(tx)
      : getERC20Recipient(tx); // Extract the actual recipient from input data

    // Get token ID for NFTs
    const tokenId = isErc1155Tx ? getERC1155TokenId(tx) : getERC721TokenId(tx);

    if (tokenValue && tokenAddress) {
      // First check enhanced cache for this contract address
      const cachedToken = tokenCache?.get(tokenAddress.toLowerCase());
      if (cachedToken) {
        const { symbol, decimals, isNft } = cachedToken;

        if (isNft) {
          // For NFTs, show count as numeric value (same as ERC20 tokens)
          const nftCount = Number(tokenValue);
          return {
            displayValue: nftCount,
            displaySymbol: symbol.toUpperCase(),
            isErc20Transfer: true, // This includes all token transfers (ERC20/721/1155)
            actualRecipient: actualRecipient || tokenAddress,
            isNft: true,
            tokenId: tokenId || undefined,
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
              // For NFTs, show count as numeric value (same as cached tokens)
              const nftCount = Number(tokenValue);
              return {
                displayValue: nftCount,
                displaySymbol: token.tokenSymbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: true,
                tokenId: tokenId || undefined,
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
        if (!skipUnknownTokenFetch) {
          try {
            let tokenDetails: ITokenDetails | null;

            // If controller is provided (background context), use direct call
            if (controller?.wallet?.getTokenDetails) {
              tokenDetails = await controller.wallet.getTokenDetails(
                tokenAddress,
                currentAccount?.address
              );
            } else {
              // Otherwise use controllerEmitter for frontend contexts
              tokenDetails = (await controllerEmitter(
                ['wallet', 'getTokenDetails'],
                [tokenAddress, currentAccount?.address]
              )) as ITokenDetails | null;
            }

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
        }
      } catch (error) {
        console.error('Error getting token info:', error);
      }

      // Fallback: show raw value with truncated contract address as symbol
      // Since we don't know if it's an NFT or the decimals, flag it
      // For unknown tokens, we'll show the raw value with a warning
      // and format it as if it might be 18 decimals (most common)
      const possibleFormattedValue = Number(tokenValue) / Math.pow(10, 18);
      const isLikelyWholeNumber = Number(tokenValue) < 1000000; // Less than 1M raw units

      return {
        displayValue: isLikelyWholeNumber
          ? tokenValue.toString() // Likely an NFT or low decimal token
          : possibleFormattedValue < 0.000001
          ? `~${possibleFormattedValue.toExponential(2)}` // Very small amount
          : `~${possibleFormattedValue.toFixed(6)}`, // Regular amount with ~ to indicate uncertainty
        displaySymbol: `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(
          -4
        )}`,
        isErc20Transfer: true, // This includes all token transfers (ERC20/721/1155)
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

    return `${formatFullPrecisionBalance(value, 4)} ${asset.tokenSymbol}`;
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
  t: (key: string) => string,
  fallbackNonce?: number
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
      [txHash, isLegacy, fallbackNonce]
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
    nonce?: number;
    txHash: string;
    updateType: UpdateTxAction;
  };
}) => {
  const { alert, chainId, isLegacy, txHash, updateType, nonce } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(
        txHash,
        isLegacy,
        chainId,
        alert,
        t,
        nonce
      );
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(txHash, isLegacy, chainId, alert, t);
  }
};

export const isERC1155Transfer = (tx: IEvmTransactionResponse) => {
  // ERC1155 uses safeTransferFrom with 5 parameters: from, to, id, amount, data
  const safeTransferFromSelector = id(
    'safeTransferFrom(address,address,uint256,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input) {
    return tx.input.startsWith(safeTransferFromSelector);
  }

  return false;
};

export const isERC20Transfer = (tx: IEvmTransactionResponse) => {
  // This detects ERC20 and ERC721 transfers (they use the same method signatures)
  const transferSelector = id('transfer(address,uint256)').slice(0, 10);
  const transferFromSelector = id(
    'transferFrom(address,address,uint256)'
  ).slice(0, 10);
  // ERC721 also has safeTransferFrom methods
  const safeTransferFrom3Selector = id(
    'safeTransferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom4Selector = id(
    'safeTransferFrom(address,address,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input) {
    return (
      tx.input.startsWith(transferSelector) ||
      tx.input.startsWith(transferFromSelector) ||
      tx.input.startsWith(safeTransferFrom3Selector) ||
      tx.input.startsWith(safeTransferFrom4Selector)
    );
  }

  return false;
};

export const isTokenTransfer = (tx: IEvmTransactionResponse) =>
  isERC20Transfer(tx) || isERC1155Transfer(tx);

export const getERC20TransferValue = (tx: IEvmTransactionResponse) => {
  const transferMethodSignature = id('transfer(address,uint256)').slice(0, 10);
  const transferFromMethodSignature = id(
    'transferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom3Selector = id(
    'safeTransferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom4Selector = id(
    'safeTransferFrom(address,address,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input) {
    if (tx.input.startsWith(transferMethodSignature)) {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[1]; // the second element is the value transferred
    } else if (tx.input.startsWith(transferFromMethodSignature)) {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2]; // the third element is the value transferred
    } else if (tx.input.startsWith(safeTransferFrom3Selector)) {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2]; // the third element is the tokenId (for ERC721)
    } else if (tx.input.startsWith(safeTransferFrom4Selector)) {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'bytes'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2]; // the third element is the tokenId (for ERC721)
    }
  }

  return null; // return null if the transaction is not a token transfer
};

export const getERC721TokenId = (
  tx: IEvmTransactionResponse
): string | null => {
  const transferMethodSignature = id('transfer(address,uint256)').slice(0, 10);
  const transferFromMethodSignature = id(
    'transferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom3Selector = id(
    'safeTransferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom4Selector = id(
    'safeTransferFrom(address,address,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input) {
    try {
      if (tx.input.startsWith(transferMethodSignature)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[1].toString(); // the second element is the tokenId
      } else if (tx.input.startsWith(transferFromMethodSignature)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[2].toString(); // the third element is the tokenId
      } else if (tx.input.startsWith(safeTransferFrom3Selector)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[2].toString(); // the third element is the tokenId
      } else if (tx.input.startsWith(safeTransferFrom4Selector)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256', 'bytes'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[2].toString(); // the third element is the tokenId
      }
    } catch (error) {
      console.error('Error parsing ERC721 token ID:', error);
    }
  }

  return null;
};

export const getERC20Recipient = (
  tx: IEvmTransactionResponse
): string | null => {
  const transferMethodSignature = id('transfer(address,uint256)').slice(0, 10);
  const transferFromMethodSignature = id(
    'transferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom3Selector = id(
    'safeTransferFrom(address,address,uint256)'
  ).slice(0, 10);
  const safeTransferFrom4Selector = id(
    'safeTransferFrom(address,address,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input) {
    try {
      if (tx.input.startsWith(transferMethodSignature)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[0]; // the first element is the recipient
      } else if (tx.input.startsWith(transferFromMethodSignature)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[1]; // the second element is the recipient
      } else if (tx.input.startsWith(safeTransferFrom3Selector)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256'],
          '0x' + tx.input.slice(10)
        );
        return decodedInput[1]; // the second element is the recipient
      } else if (tx.input.startsWith(safeTransferFrom4Selector)) {
        const decodedInput = defaultAbiCoder.decode(
          ['address', 'address', 'uint256', 'bytes'],
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

export const getERC1155TransferValue = (tx: IEvmTransactionResponse) => {
  const safeTransferFromSelector = id(
    'safeTransferFrom(address,address,uint256,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input && tx.input.startsWith(safeTransferFromSelector)) {
    try {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'bytes'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[3]; // the fourth element is the amount transferred
    } catch (error) {
      console.error('Error parsing ERC1155 transfer value:', error);
    }
  }

  return null;
};

export const getERC1155TokenId = (
  tx: IEvmTransactionResponse
): string | null => {
  const safeTransferFromSelector = id(
    'safeTransferFrom(address,address,uint256,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input && tx.input.startsWith(safeTransferFromSelector)) {
    try {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'bytes'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[2].toString(); // the third element is the token ID
    } catch (error) {
      console.error('Error parsing ERC1155 token ID:', error);
    }
  }

  return null;
};

export const getERC1155Recipient = (
  tx: IEvmTransactionResponse
): string | null => {
  const safeTransferFromSelector = id(
    'safeTransferFrom(address,address,uint256,uint256,bytes)'
  ).slice(0, 10);

  if (tx?.input && tx.input.startsWith(safeTransferFromSelector)) {
    try {
      const decodedInput = defaultAbiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'bytes'],
        '0x' + tx.input.slice(10)
      );
      return decodedInput[1]; // the second element is the recipient
    } catch (error) {
      console.error('Error parsing ERC1155 recipient:', error);
    }
  }

  return null;
};
