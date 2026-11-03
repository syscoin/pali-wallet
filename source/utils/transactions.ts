import { omit } from 'lodash';

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { IEvmTransactionResponse } from 'scripts/Background/controllers/transactions/types';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { ITokenDetails } from 'types/tokens';
import { ITransactionParams, ITxState } from 'types/transactions';
import { formatUnits } from 'utils/ethersV6Compat';
import { id } from 'utils/ethersV6Compat';
import { getAddress } from 'utils/ethersV6Compat';
import { defaultAbiCoder } from 'utils/ethersV6Compat';

import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmNonce';
import { formatCurrency, truncate, formatFullPrecisionBalance } from './format';
import {
  getWalletNavigationScope,
  IWalletNavigationScope,
} from './navigationState';

const ERC721_SAFE_TRANSFER_SIGNATURE =
  'safeTransferFrom(address,address,uint256)';
const ERC721_SAFE_TRANSFER_DATA_SIGNATURE =
  'safeTransferFrom(address,address,uint256,bytes)';
const TOKEN_TRANSFER_FROM_SIGNATURE = 'transferFrom(address,address,uint256)';
const ERC1155_SAFE_TRANSFER_SIGNATURE =
  'safeTransferFrom(address,address,uint256,uint256,bytes)';

/**
 * Get proper display information for a transaction (value, symbol, recipient, and type)
 * Uses the same logic as notification manager for consistent display
 * @param tx Transaction object
 * @param currency Network currency (e.g., 'ETH', 'NEVM')
 * @param skipUnknownTokenFetch Skip fetching unknown tokens
 * @param controller Optional controller instance for background context calls
 * @returns Object with displayValue, displaySymbol, isErc20Transfer, actualRecipient, isNft, and hasUnknownDecimals
 */
export const getTransactionDisplayInfo = async (
  tx: any,
  currency: string,
  skipUnknownTokenFetch = false,
  controller?: any
): Promise<{
  actualRecipient: string;
  displaySymbol: string;
  displayValue: number | string;
  formattedValue: string;
  hasUnknownDecimals?: boolean;
  isErc20Transfer: boolean; // Note: This includes all token transfers (ERC20/721/1155), not just ERC20
  isNft: boolean;
  nftQuantity?: string;
  tokenId?: string; // Token ID for NFTs
}> => {
  const smartAccountInnerTx = getSmartAccountDisplayTransaction(tx);
  if (smartAccountInnerTx) {
    return getTransactionDisplayInfo(
      smartAccountInnerTx,
      currency,
      skipUnknownTokenFetch,
      controller
    );
  }

  // A token endpoint returns event amounts and recipients. Its `value` is not
  // the outer transaction's native payment and its input may be unavailable.
  if (
    tx?.historySource === EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer
  ) {
    const { activeAccount, accountAssets, activeNetwork } =
      store.getState().vault;
    const chainId = Number(tx.chainId ?? activeNetwork.chainId);
    const event = tx.tokenTransfer || {
      chainId,
      contractAddress: tx.to,
      recipient: tx.tokenRecipient,
      value: tx.value,
    };
    const validAddress = (value: unknown): value is string =>
      typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
    const uint = (value: unknown): string | undefined => {
      const text = typeof value === 'string' ? value : String(value ?? '');
      return /^\d{1,78}$/.test(text) &&
        BigInt(text) <=
          BigInt(
            '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
          )
        ? text
        : undefined;
    };
    if (
      Number(event.chainId) === chainId &&
      validAddress(event.contractAddress) &&
      validAddress(event.recipient)
    ) {
      const asset = accountAssets[activeAccount.type]?.[
        activeAccount.id
      ]?.ethereum?.find(
        (candidate) =>
          Number(candidate.chainId) === chainId &&
          candidate.contractAddress?.toLowerCase() ===
            event.contractAddress.toLowerCase()
      );
      const tokenId = uint(event.tokenId);
      const isNft = tokenId !== undefined || asset?.isNft === true;
      const isErc1155 =
        (event.tokenStandard || asset?.tokenStandard) === 'ERC-1155';
      const amount = isNft && !isErc1155 ? '1' : uint(event.value);
      const rawDecimals = asset?.decimals ?? event.decimals;
      const decimals = Number(rawDecimals);
      const hasDecimals =
        rawDecimals !== undefined &&
        rawDecimals !== null &&
        rawDecimals !== '' &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 255;
      const symbol = asset?.tokenSymbol || event.symbol;
      const displaySymbol =
        typeof symbol === 'string' && symbol.trim()
          ? symbol.toUpperCase()
          : isNft
          ? 'NFT'
          : `${event.contractAddress.slice(
              0,
              6
            )}...${event.contractAddress.slice(-4)}`;
      const knownAmount = amount !== undefined && (isNft || hasDecimals);
      const formattedValue =
        amount === undefined
          ? '?'
          : isNft || !hasDecimals
          ? amount
          : formatUnits(amount, decimals);
      return {
        actualRecipient: event.recipient,
        displaySymbol,
        displayValue: formattedValue,
        formattedValue,
        isErc20Transfer: true,
        isNft,
        ...(isErc1155 && amount !== undefined ? { nftQuantity: amount } : {}),
        ...(tokenId !== undefined ? { tokenId } : {}),
        ...(!knownAmount ? { hasUnknownDecimals: true } : {}),
      };
    }
  }

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

    if (tokenValue !== null && tokenValue !== undefined && tokenAddress) {
      // Try to get token info from user's assets or fetch from controller
      try {
        const { accounts, activeAccount, accountAssets, activeNetwork } =
          store.getState().vault;
        const transactionChainId = Number(tx.chainId ?? activeNetwork.chainId);
        const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
        const userAssets =
          accountAssets[activeAccount.type]?.[activeAccount.id];

        // Check user's account assets first (fastest)
        if (userAssets?.ethereum) {
          const token = userAssets.ethereum.find(
            (asset) =>
              Number(asset.chainId) === transactionChainId &&
              asset.contractAddress?.toLowerCase() ===
                tokenAddress.toLowerCase()
          );

          if (token) {
            const isNft = token.isNft || false;
            const rawDecimals = isNft ? 0 : Number(token.decimals ?? 18);
            const decimals =
              Number.isFinite(rawDecimals) && rawDecimals >= 0
                ? rawDecimals
                : 18;

            if (isNft) {
              // For NFTs: if ERC-721, displayValue should be 1 and tokenId is the ID
              // If ERC-1155, tokenValue represents the amount transferred
              const nftCount = isErc1155Tx ? tokenValue.toString() : 1;
              return {
                displayValue: nftCount,
                formattedValue: String(nftCount),
                displaySymbol: token.tokenSymbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: true,
                tokenId: tokenId || undefined,
              };
            } else {
              // Regular ERC-20 token
              const numeric = parseFloat(formatUnits(tokenValue, decimals));
              return {
                displayValue: numeric,
                formattedValue: formatFullPrecisionBalance(numeric, 4),
                displaySymbol: token.tokenSymbol.toUpperCase(),
                isErc20Transfer: true,
                actualRecipient: actualRecipient || tokenAddress,
                isNft: false,
              };
            }
          }
        }

        // If not in user's assets, try to fetch from controller
        // The metadata RPC always targets the current network. It must never
        // label a historical transaction from another chain.
        if (
          !skipUnknownTokenFetch &&
          transactionChainId === Number(activeNetwork.chainId)
        ) {
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

            const latestVault = store.getState().vault;
            const sameContext =
              Number(latestVault.activeNetwork.chainId) ===
                transactionChainId &&
              latestVault.activeNetwork.url === activeNetwork.url &&
              latestVault.activeAccount.id === activeAccount.id &&
              latestVault.activeAccount.type === activeAccount.type;
            if (tokenDetails && sameContext) {
              const isNft = tokenDetails.isNft || false;
              const rawDecimals = isNft
                ? 0
                : Number(tokenDetails.decimals ?? 18);
              const decimals =
                Number.isFinite(rawDecimals) && rawDecimals >= 0
                  ? rawDecimals
                  : 18;

              if (isNft) {
                // For NFTs: if ERC-721, count is 1; if ERC-1155, use provided amount
                const nftCount = isErc1155Tx ? tokenValue.toString() : 1;
                return {
                  displayValue: nftCount,
                  formattedValue: String(nftCount),
                  displaySymbol: tokenDetails.symbol.toUpperCase(),
                  isErc20Transfer: true,
                  actualRecipient: actualRecipient || tokenAddress,
                  isNft: true,
                  tokenId: tokenId || undefined,
                };
              } else {
                // Regular ERC-20 token
                const numeric = parseFloat(formatUnits(tokenValue, decimals));
                return {
                  displayValue: numeric,
                  formattedValue: formatFullPrecisionBalance(numeric, 4),
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

      // Fallbacks when token metadata is not available (e.g., list view skips fetch):
      // - Best-effort NFT identification to improve Activity list display without network calls
      // - Otherwise, show a generic token transfer with unknown decimals

      // If we can infer NFT type purely from the method selector, surface that so
      // the Activity list can render helpful strings like "1 NFT #123" or "2 NFT #3"
      try {
        // ERC-1155 safeTransferFrom has an unambiguous selector
        if (isErc1155Tx) {
          const erc1155Value = getERC1155TransferValue(tx);
          const nftAmount =
            erc1155Value === null || erc1155Value === undefined
              ? '1'
              : erc1155Value.toString();
          const inferredTokenId = getERC1155TokenId(tx) || undefined;
          return {
            displayValue: nftAmount,
            formattedValue: String(nftAmount),
            displaySymbol: 'NFT',
            isErc20Transfer: true,
            actualRecipient: actualRecipient || tokenAddress,
            isNft: true,
            tokenId: inferredTokenId,
          };
        }

        // Only the safeTransferFrom selectors identify ERC-721 without
        // metadata. ERC-20 shares transferFrom(address,address,uint256).
        const safeTransferFrom3Selector = id(
          ERC721_SAFE_TRANSFER_SIGNATURE
        ).slice(0, 10);
        const safeTransferFrom4Selector = id(
          ERC721_SAFE_TRANSFER_DATA_SIGNATURE
        ).slice(0, 10);
        const isErc721Candidate =
          !!tx?.input &&
          (tx.input.startsWith(safeTransferFrom3Selector) ||
            tx.input.startsWith(safeTransferFrom4Selector));

        const erc721TokenId = isErc721Candidate ? getERC721TokenId(tx) : null;
        if (isErc721Candidate && erc721TokenId) {
          return {
            displayValue: 1,
            formattedValue: '1',
            displaySymbol: 'NFT',
            isErc20Transfer: true,
            actualRecipient: actualRecipient || tokenAddress,
            isNft: true,
            tokenId: erc721TokenId,
          };
        }
      } catch (nftInferenceError) {
        // Non-fatal: fall through to generic unknown token handling below
        // console.warn('NFT inference failed', nftInferenceError);
      }

      // Generic unknown token fallback: show raw value with truncated contract address as symbol
      // Since we don't know if it's an NFT or the decimals, flag it
      // and format it as if it might be 18 decimals (most common)
      const possibleFormattedValue = parseFloat(formatUnits(tokenValue, 18));
      const isLikelyWholeNumber = Number(tokenValue) < 1000000; // Less than 1M raw units

      const unknownStr = isLikelyWholeNumber
        ? tokenValue.toString() // Likely an NFT or low decimal token
        : possibleFormattedValue < 0.000001
        ? `~${possibleFormattedValue.toExponential(2)}` // Very small amount
        : `~${possibleFormattedValue.toFixed(6)}`; // Regular amount with ~ to indicate uncertainty
      return {
        displayValue: unknownStr,
        formattedValue: unknownStr,
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

  try {
    // Use formatUnits to avoid precision loss and handle BigNumberish inputs
    // Accept hex string, decimal string, BigNumber-like, or number
    // Normalize to a value acceptable by formatUnits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bigNumberishValue: any = rawValue;
    if (rawValue && typeof rawValue === 'object') {
      // Support ethers-style objects with hex/_hex
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const asAny: any = rawValue;
      if (typeof asAny.hex === 'string') {
        bigNumberishValue = asAny.hex;
      } else if (typeof asAny._hex === 'string') {
        bigNumberishValue = asAny._hex;
      }
    }

    const formatted = formatUnits(bigNumberishValue ?? '0', 18);
    numericValue = Number.isFinite(Number(formatted))
      ? parseFloat(formatted)
      : 0;
  } catch {
    numericValue = 0;
  }

  return {
    displayValue: numericValue,
    formattedValue: formatFullPrecisionBalance(numericValue, 4),
    displaySymbol: currency.toUpperCase(),
    isErc20Transfer: false,
    actualRecipient: tx.to || '', // For native transfers, tx.to is the actual recipient
    isNft: false,
  };
};

const ENTRYPOINT_HANDLE_OPS_SELECTOR = id(
  'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)'
).slice(0, 10);
const ERC7579_EXECUTE_SELECTOR = id('execute(bytes32,bytes)').slice(0, 10);
const INSTALL_MODULE_SELECTOR = id(
  'installModule(uint256,address,bytes)'
).slice(0, 10);
const UNINSTALL_MODULE_SELECTOR = id(
  'uninstallModule(uint256,address,bytes)'
).slice(0, 10);
const ROTATE_VALIDATOR_SELECTOR = id(
  'rotateValidator(address,bytes,bytes)'
).slice(0, 10);

const decodeERC7579ExecutionCalldata = (
  mode: string,
  executionCalldata: string
): any[] | null => {
  const callType = mode.slice(0, 4).toLowerCase();
  if (callType === '0x00') {
    if (executionCalldata.length < 106) {
      return null;
    }
    const target = getAddress(`0x${executionCalldata.slice(2, 42)}`);
    const [value] = defaultAbiCoder.decode(
      ['uint256'],
      `0x${executionCalldata.slice(42, 106)}`
    );
    const data = `0x${executionCalldata.slice(106)}`;

    return [{ data, target, value }];
  }

  if (callType === '0x01') {
    const [executions] = defaultAbiCoder.decode(
      ['tuple(address target,uint256 value,bytes callData)[]'],
      executionCalldata
    ) as unknown as [any[]];

    return executions.map((execution) => ({
      data: execution.callData || execution.data || execution[2] || '0x',
      target: execution.target || execution[0],
      value: execution.value || execution[1] || '0',
    }));
  }

  return null;
};

/** Decode every inner ERC-7579 execution while preserving the outer history. */
export const getSmartAccountExecutionTransactions = (
  tx: any,
  {
    requireDefaultExecution = false,
    requireMatchingSmartAccount = false,
  }: {
    requireDefaultExecution?: boolean;
    requireMatchingSmartAccount?: boolean;
  } = {}
): any[] => {
  const input = String(tx?.input || tx?.data || '');
  if (!input || input === '0x' || input.length < 10) {
    return [];
  }

  try {
    let executions: any[] | null = null;
    let smartAccountExecutionFrom = tx.smartAccountExecutionFrom || tx.from;
    if (input.startsWith(ENTRYPOINT_HANDLE_OPS_SELECTOR)) {
      const [userOperations] = defaultAbiCoder.decode(
        [
          'tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[]',
          'address',
        ],
        `0x${input.slice(10)}`
      ) as unknown as [any[], string];
      const smartAccount = String(
        tx.smartAccountExecutionFrom || ''
      ).toLowerCase();
      const matchingUserOperation = userOperations.find(
        (operation) =>
          smartAccount &&
          String(operation.sender || operation[0]).toLowerCase() ===
            smartAccount
      );
      const userOperation = matchingUserOperation || userOperations[0];
      if (requireMatchingSmartAccount && !matchingUserOperation) {
        return [];
      }
      const callData = String(
        userOperation?.callData || userOperation?.[3] || ''
      );
      if (!callData.startsWith(ERC7579_EXECUTE_SELECTOR)) {
        return [];
      }
      const [mode, executionCalldata] = defaultAbiCoder.decode(
        ['bytes32', 'bytes'],
        `0x${callData.slice(10)}`
      ) as unknown as [string, string];
      if (requireDefaultExecution && mode.slice(4, 6).toLowerCase() !== '00') {
        return [];
      }
      executions = decodeERC7579ExecutionCalldata(mode, executionCalldata);
      smartAccountExecutionFrom =
        tx.smartAccountExecutionFrom ||
        userOperation.sender ||
        userOperation[0] ||
        tx.from;
    } else {
      return [];
    }

    if (!executions?.length) {
      return [];
    }

    return executions.map((execution) => ({
      ...tx,
      from: smartAccountExecutionFrom,
      input: execution.data || '0x',
      data: execution.data || '0x',
      to: execution.target,
      value: execution.value?.toString?.() || String(execution.value || '0'),
    }));
  } catch (error) {
    return [];
  }
};

export const getSmartAccountDisplayTransaction = (tx: any): any | null => {
  const executions = getSmartAccountExecutionTransactions(tx);
  if (executions.length === 0) {
    return null;
  }

  try {
    const outerTo = String(tx?.to || '').toLowerCase();
    const smartAccount = String(executions[0]?.from || '').toLowerCase();
    const isMeaningfulExecution = (execution: any) => {
      const target = String(execution.to || '').toLowerCase();
      const data = String(execution.input || execution.data || '0x');
      const value = String(execution.value || '0');

      return (
        data !== '0x' ||
        value !== '0' ||
        (target !== outerTo && target !== smartAccount)
      );
    };
    const moduleInstallExecution = executions.find((execution) => {
      const data = String(
        execution.input || execution.data || '0x'
      ).toLowerCase();
      return (
        data.startsWith(INSTALL_MODULE_SELECTOR) ||
        data.startsWith(ROTATE_VALIDATOR_SELECTOR)
      );
    });
    const hasModuleUninstallExecution = executions.some((execution) => {
      const data = String(
        execution.input || execution.data || '0x'
      ).toLowerCase();
      return data.startsWith(UNINSTALL_MODULE_SELECTOR);
    });
    const selected =
      (hasModuleUninstallExecution && moduleInstallExecution) ||
      executions.find((execution) => isMeaningfulExecution(execution)) ||
      executions[executions.length - 1];

    return selected;
  } catch (error) {
    return null;
  }
};

export const getAssetBalance = (asset: any, isBitcoinBased: boolean) => {
  if (!isBitcoinBased) {
    const value = Number(asset.balance);

    return `${formatFullPrecisionBalance(value, 4)} ${asset.tokenSymbol}`;
  }

  const formattedBalance = truncate(
    asset.decimals === 0
      ? String(asset.balance ?? '0')
      : formatCurrency(String(asset.balance ?? '0'), asset.decimals),
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
  t: (key: string, options?: { hash: string }) => string,
  fallbackNonce: number | undefined,
  signerAddress: string | undefined,
  walletScope: IWalletNavigationScope,
  approvedMaximumFee: string | undefined
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.cancelNotAvailableUtxo'));
    return;
  }

  try {
    const current = getWalletNavigationScope();
    if (
      !walletScope ||
      current.account !== walletScope.account ||
      current.network !== walletScope.network ||
      Number(store.getState().vault.activeNetwork?.chainId) !== chainId
    )
      throw new Error('Transaction context changed');
    const response = await controllerEmitter(
      ['wallet', 'cancelEvmTransaction'],
      [
        txHash,
        isLegacy,
        fallbackNonce,
        signerAddress,
        { chainId, walletScope },
        { approvedMaximumFee },
      ]
    );

    if (!response) {
      alert.error(t('transactions.transactionCancelFailed'));
      return;
    }

    const { isCanceled, error, transaction } = response as {
      error: boolean;
      isCanceled: boolean;
      transaction?: IEvmTransactionResponse;
    };

    if (!isCanceled && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isCanceled) {
      case true:
        try {
          await controllerEmitter(
            ['wallet', 'setEvmTransactionCancelSubmitted'],
            [txHash, chainId, transaction]
          );
        } catch (metadataError) {
          if (
            error ||
            typeof transaction?.hash !== 'string' ||
            !/^0x[0-9a-f]{64}$/i.test(transaction.hash)
          )
            throw metadataError;
          console.error(
            'Replacement history could not be saved:',
            metadataError
          );
          alert.warning(
            t('transactions.replacementHistoryWarning', {
              hash: transaction.hash,
            })
          );
          return transaction.hash;
        }

        alert.success(t('transactions.transactionCancelSubmitted'));
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

export const previewCancelTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  nonce: number | undefined,
  signerAddress: string | undefined,
  walletScope: IWalletNavigationScope
): Promise<string> => {
  const response = (await controllerEmitter(
    ['wallet', 'cancelEvmTransaction'],
    [
      txHash,
      isLegacy,
      nonce,
      signerAddress,
      { chainId, walletScope },
      { previewOnly: true },
    ]
  )) as
    | { error?: boolean; isCanceled?: boolean; maximumFee?: string }
    | undefined;
  const current = getWalletNavigationScope();
  const maximumFee = response?.maximumFee;
  if (
    current.account !== walletScope.account ||
    current.network !== walletScope.network ||
    response?.error === true ||
    response?.isCanceled !== false ||
    typeof maximumFee !== 'string' ||
    !/^(0|[1-9][0-9]{0,77})$/.test(maximumFee)
  )
    throw new Error('Cancellation fee unavailable');
  return maximumFee;
};

const requestSpeedUp = (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  signerAddress: string | undefined,
  options: { approvedMaximumFee?: string; previewOnly?: boolean }
) =>
  store.getState().vault.activeAccount?.type === KeyringAccountType.SmartAccount
    ? controllerEmitter(
        ['wallet', 'speedUpEvmTransaction'],
        [txHash, isLegacy, chainId, signerAddress, options]
      )
    : controllerEmitter(
        ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
        [txHash, isLegacy, options]
      );

export const previewSpeedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  signerAddress?: string
): Promise<string> => {
  const { isBitcoinBased, activeNetwork } = store.getState().vault;
  if (isBitcoinBased || Number(activeNetwork?.chainId) !== chainId)
    throw new Error('Transaction network changed');
  const scope = getWalletNavigationScope();
  const response = (await requestSpeedUp(
    txHash,
    isLegacy,
    chainId,
    signerAddress,
    { previewOnly: true }
  )) as
    | {
        code?: string;
        error?: boolean;
        isSpeedUp?: boolean;
        maximumFee?: string;
      }
    | undefined;
  const current = getWalletNavigationScope();
  const maximumFee = response?.maximumFee;
  if (
    current.account !== scope.account ||
    current.network !== scope.network ||
    store.getState().vault.isBitcoinBased
  )
    throw new Error('Transaction context changed');
  if (response?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE')
    throw Object.assign(new Error('Replacement would change the amount'), {
      code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
    });
  if (
    response?.error === true ||
    response?.isSpeedUp !== false ||
    typeof maximumFee !== 'string' ||
    maximumFee.length > 78 ||
    !/^(0|[1-9][0-9]*)$/.test(maximumFee)
  )
    throw new Error('Replacement fee unavailable');
  return maximumFee;
};

const speedUpTransaction = async (
  txHash: string,
  isLegacy: boolean,
  chainId: number,
  alert: any,
  t: (key: string, options?: { hash: string }) => string,
  signerAddress?: string,
  approvedMaximumFee?: string,
  walletScope?: IWalletNavigationScope
) => {
  // Safety check: this function is only for EVM networks
  const { isBitcoinBased } = store.getState().vault;
  if (isBitcoinBased) {
    alert.error(t('transactions.speedUpNotAvailableUtxo'));
    return;
  }

  try {
    const current = getWalletNavigationScope();
    if (
      walletScope &&
      (current.account !== walletScope.account ||
        current.network !== walletScope.network ||
        Number(store.getState().vault.activeNetwork?.chainId) !== chainId)
    )
      throw new Error('Transaction context changed');
    const response = await requestSpeedUp(
      txHash,
      isLegacy,
      chainId,
      signerAddress,
      { approvedMaximumFee }
    ).catch((error) => {
      if (error?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE') return error;
      throw error;
    });

    if (!response) {
      alert.error(t('transactions.transactionSpeedUpFailed'));
      return;
    }

    const { isSpeedUp, error, transaction, code } = response as {
      code?: string;
      error: boolean;
      isSpeedUp: boolean;
      transaction: IEvmTransactionResponse;
    };

    if (code === 'REPLACEMENT_VALUE_WOULD_CHANGE') {
      const latest = getWalletNavigationScope();
      if (
        walletScope &&
        (latest.account !== walletScope.account ||
          latest.network !== walletScope.network ||
          Number(store.getState().vault.activeNetwork?.chainId) !== chainId)
      )
        return;
      alert.error(t('transactions.speedUpAmountWouldChange'));
      return;
    }
    if (!isSpeedUp && error) {
      alert.warning(t('transactions.transactionNotFoundOrConfirmed'));
      return;
    }

    switch (isSpeedUp) {
      case true:
        try {
          await controllerEmitter(
            ['wallet', 'setEvmTransactionAsAccelerated'],
            [txHash, chainId, transaction]
          );
        } catch (metadataError) {
          if (
            error ||
            typeof transaction?.hash !== 'string' ||
            !/^0x[0-9a-f]{64}$/i.test(transaction.hash)
          )
            throw metadataError;
          console.error(
            'Replacement history could not be saved:',
            metadataError
          );
          alert.warning(
            t('transactions.replacementHistoryWarning', {
              hash: transaction.hash,
            })
          );
          return transaction.hash;
        }

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
  t: (key: string, options?: { hash: string }) => string;
  updateData: {
    alert: any;
    approvedMaximumFee?: string;
    chainId: number;
    isLegacy: boolean;
    nonce?: number;
    signerAddress?: string;
    txHash: string;
  } & (
    | { updateType: UpdateTxAction.Cancel; walletScope: IWalletNavigationScope }
    | {
        updateType: UpdateTxAction.SpeedUp;
        walletScope?: IWalletNavigationScope;
      }
  );
}) => {
  const {
    alert,
    approvedMaximumFee,
    chainId,
    isLegacy,
    txHash,
    updateType,
    nonce,
    signerAddress,
    walletScope,
  } = updateData;

  switch (updateType) {
    case UpdateTxAction.Cancel:
      return await cancelTransaction(
        txHash,
        isLegacy,
        chainId,
        alert,
        t,
        nonce,
        signerAddress,
        walletScope,
        approvedMaximumFee
      );
    case UpdateTxAction.SpeedUp:
      return await speedUpTransaction(
        txHash,
        isLegacy,
        chainId,
        alert,
        t,
        signerAddress,
        approvedMaximumFee,
        walletScope
      );
  }
};

export const isERC1155Transfer = (tx: IEvmTransactionResponse) => {
  // ERC1155 uses safeTransferFrom with 5 parameters: from, to, id, amount, data
  const safeTransferFromSelector = id(ERC1155_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );

  if (tx?.input) {
    return tx.input.startsWith(safeTransferFromSelector);
  }

  return false;
};

export const isERC20Transfer = (tx: IEvmTransactionResponse) => {
  // This detects ERC20 and ERC721 transfers (they use the same method signatures)
  const transferSelector = id('transfer(address,uint256)').slice(0, 10);
  const transferFromSelector = id(TOKEN_TRANSFER_FROM_SIGNATURE).slice(0, 10);
  // ERC721 also has safeTransferFrom methods
  const safeTransferFrom3Selector = id(ERC721_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom4Selector = id(
    ERC721_SAFE_TRANSFER_DATA_SIGNATURE
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
  const transferFromMethodSignature = id(TOKEN_TRANSFER_FROM_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom3Selector = id(ERC721_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom4Selector = id(
    ERC721_SAFE_TRANSFER_DATA_SIGNATURE
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
  const transferFromMethodSignature = id(TOKEN_TRANSFER_FROM_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom3Selector = id(ERC721_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom4Selector = id(
    ERC721_SAFE_TRANSFER_DATA_SIGNATURE
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
  const transferFromMethodSignature = id(TOKEN_TRANSFER_FROM_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom3Selector = id(ERC721_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );
  const safeTransferFrom4Selector = id(
    ERC721_SAFE_TRANSFER_DATA_SIGNATURE
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
  const safeTransferFromSelector = id(ERC1155_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );

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
  const safeTransferFromSelector = id(ERC1155_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );

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
  const safeTransferFromSelector = id(ERC1155_SAFE_TRANSFER_SIGNATURE).slice(
    0,
    10
  );

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
