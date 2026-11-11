import { defaultAbiCoder, formatUnits, id } from '../utils/ethersV6Compat.ts';

import {
  formatTokenUnits,
  parseErc20Decimals,
  parseErc20Units,
} from './erc20.ts';
import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmHistory.ts';
import { snapshotNftTransferIntent } from './nftTransfer.ts';

/** Public display facts only; no wallet, provider, storage or signing authority. */
export type EvmDisplayTransaction = {
  chainId?: unknown;
  collectibleTransfer?: unknown;
  from?: unknown;
  historySource?: unknown;
  input?: string;
  to?: string | null;
  tokenRecipient?: unknown;
  tokenTransfer?: {
    chainId?: unknown;
    contractAddress?: unknown;
    decimals?: unknown;
    recipient?: unknown;
    symbol?: unknown;
    tokenId?: unknown;
    tokenStandard?: unknown;
    value?: unknown;
  };
  value?: unknown;
};
export type EvmDisplayTokenMetadata = {
  chainId?: unknown;
  contractAddress?: string;
  decimals?: unknown;
  isNft?: boolean;
  symbol?: string;
  tokenStandard?: string;
  tokenSymbol?: string;
};
export type EvmTransactionDisplayInfo = {
  actualRecipient: string;
  amountUnavailable?: true;
  displaySymbol: string;
  displayValue: number | string;
  formattedValue: string;
  hasUnknownDecimals?: boolean;
  isErc20Transfer: boolean;
  isNft: boolean;
  nftQuantity?: string;
  tokenId?: string;
};
export type EvmDisplayContext = {
  assets?: readonly EvmDisplayTokenMetadata[];
  chainId?: unknown;
  /** Optional host-owned lookup. The host must discard stale context results. */
  lookupToken?: (
    contractAddress: string
  ) => Promise<EvmDisplayTokenMetadata | null>;
};
const ERC721_SAFE_TRANSFER_SIGNATURE =
  'safeTransferFrom(address,address,uint256)';
const ERC721_SAFE_TRANSFER_DATA_SIGNATURE =
  'safeTransferFrom(address,address,uint256,bytes)';
const TOKEN_TRANSFER_FROM_SIGNATURE = 'transferFrom(address,address,uint256)';
const ERC1155_SAFE_TRANSFER_SIGNATURE =
  'safeTransferFrom(address,address,uint256,uint256,bytes)';

// Use the existing uint8 precision policy; external string metadata is decoded
// once, while absent/non-scalar metadata stays unknown.
const knownPrecision = (raw: unknown): number | undefined => {
  if (
    !['number', 'string', 'bigint'].includes(typeof raw) ||
    (typeof raw === 'string' && !raw.trim())
  )
    return undefined;
  try {
    return parseErc20Decimals(Number(raw));
  } catch {
    return undefined;
  }
};

const knownTokenDisplay = (
  token: EvmDisplayTokenMetadata,
  tokenValue: bigint,
  isErc1155Tx: boolean,
  actualRecipient: string | null,
  tokenAddress: string,
  tokenId: string | null
): EvmTransactionDisplayInfo | undefined => {
  const isNft = token.isNft || false;
  const symbol = token.tokenSymbol ?? token.symbol;
  if (typeof symbol !== 'string') return undefined;
  if (isNft) {
    const nftCount = isErc1155Tx ? tokenValue.toString() : 1;
    return {
      displayValue: nftCount,
      formattedValue: String(nftCount),
      displaySymbol: symbol.toUpperCase(),
      isErc20Transfer: true,
      actualRecipient: actualRecipient || tokenAddress,
      isNft: true,
      tokenId: tokenId || undefined,
    };
  }
  const decimals = knownPrecision(token.decimals);
  if (decimals === undefined) return undefined;
  const exact = formatTokenUnits(tokenValue.toString(), decimals).replace(
    /\.0$/,
    ''
  );
  return {
    displayValue: exact,
    formattedValue: exact,
    displaySymbol: symbol.toUpperCase(),
    isErc20Transfer: true,
    actualRecipient: actualRecipient || tokenAddress,
    isNft: false,
  };
};

/** Existing extension interpretation, shared without host state or implicit reads. */
export const getEvmTransactionDisplayInfo = async (
  tx: EvmDisplayTransaction,
  currency: string,
  context: EvmDisplayContext = {}
): Promise<EvmTransactionDisplayInfo> => {
  if (
    tx?.historySource === EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned &&
    tx.collectibleTransfer
  ) {
    try {
      const intent = snapshotNftTransferIntent(tx.collectibleTransfer);
      if (
        Number(tx.chainId) !== Number(intent.chainId) ||
        typeof tx.from !== 'string' ||
        tx.from.toLowerCase() !== intent.from.toLowerCase() ||
        tx.to?.toLowerCase() !== intent.contractAddress.toLowerCase() ||
        !(typeof tx.value === 'string' && /^0+$/.test(tx.value))
      )
        throw new Error('Invalid retained NFT display context');
      return {
        actualRecipient: intent.recipient,
        displaySymbol: 'NFT',
        displayValue: intent.amountUnits,
        formattedValue: intent.amountUnits,
        isErc20Transfer: true,
        isNft: true,
        tokenId: intent.tokenId,
        ...(intent.tokenStandard === 'ERC-1155'
          ? { nftQuantity: intent.amountUnits }
          : {}),
      };
    } catch {
      return {
        actualRecipient: '',
        displaySymbol: 'NFT',
        displayValue: '?',
        formattedValue: '?',
        isErc20Transfer: true,
        isNft: true,
        amountUnavailable: true,
      };
    }
  }
  // A retained ERC-20 summary contains facts decoded from the signed call,
  // but deliberately has no input/calldata. Keep this path distinct from
  // explorer events and never interpret its token units as native currency.
  if (
    tx?.historySource === EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned &&
    tx.tokenTransfer
  ) {
    const event = tx.tokenTransfer;
    const chainId = Number(tx.chainId);
    const validAddress = (value: unknown): value is string =>
      typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
    const unavailable: EvmTransactionDisplayInfo = {
      actualRecipient: '',
      displaySymbol: 'TOKEN',
      displayValue: '?',
      formattedValue: '?',
      isErc20Transfer: true,
      isNft: false,
      amountUnavailable: true,
    };
    if (
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      Number(event.chainId) !== chainId ||
      !validAddress(tx.to) ||
      !validAddress(event.contractAddress) ||
      event.contractAddress.toLowerCase() !== tx.to.toLowerCase() ||
      !validAddress(event.recipient) ||
      !(typeof event.value === 'string' && /^\d{1,78}$/.test(event.value)) ||
      !(typeof tx.value === 'string' && /^0+$/.test(tx.value))
    )
      return unavailable;
    let units: string;
    try {
      units = parseErc20Units(event.value);
    } catch {
      return unavailable;
    }
    const asset =
      Number(context.chainId) === chainId
        ? context.assets?.find(
            (candidate) =>
              Number(candidate.chainId) === chainId &&
              candidate.contractAddress?.toLowerCase() ===
                tx.to?.toLowerCase() &&
              !candidate.isNft
          )
        : undefined;
    const decimals =
      knownPrecision(event.decimals) ?? knownPrecision(asset?.decimals);
    const metadataSymbol =
      typeof event.symbol === 'string' && event.symbol.trim()
        ? event.symbol
        : asset?.tokenSymbol || asset?.symbol;
    const displaySymbol =
      typeof metadataSymbol === 'string' && metadataSymbol.trim()
        ? metadataSymbol.toUpperCase()
        : `${event.contractAddress.slice(0, 6)}...${event.contractAddress.slice(
            -4
          )}`;
    const formattedValue =
      decimals === undefined ? '?' : formatTokenUnits(units, decimals);
    return {
      actualRecipient: event.recipient,
      displaySymbol,
      displayValue: formattedValue,
      formattedValue,
      isErc20Transfer: true,
      isNft: false,
      ...(decimals === undefined
        ? { hasUnknownDecimals: true, amountUnavailable: true }
        : {}),
    };
  }
  // A token endpoint returns event amounts and recipients. Its `value` is not
  // the outer transaction's native payment and its input may be unavailable.
  if (
    tx?.historySource === EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer
  ) {
    const chainId = Number(tx.chainId ?? context.chainId);
    const event = tx.tokenTransfer || {
      chainId,
      contractAddress: tx.to,
      recipient: tx.tokenRecipient,
      value: tx.value,
    };
    const validAddress = (value: unknown): value is string =>
      typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
    const uint = (value: unknown): string | undefined => {
      if (
        typeof value === 'number' &&
        (!Number.isSafeInteger(value) || value < 0)
      )
        return undefined;
      const text =
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint'
          ? String(value)
          : '';
      if (!/^\d{1,78}$/.test(text)) return undefined;
      try {
        parseErc20Units(BigInt(text));
        return text;
      } catch {
        return undefined;
      }
    };
    if (
      Number(event.chainId) === chainId &&
      validAddress(event.contractAddress) &&
      validAddress(event.recipient)
    ) {
      const contractAddress = event.contractAddress;
      const asset = context.assets?.find(
        (candidate) =>
          Number(candidate.chainId) === chainId &&
          candidate.contractAddress?.toLowerCase() ===
            contractAddress.toLowerCase()
      );
      const tokenId = uint(event.tokenId);
      const isNft = tokenId !== undefined || asset?.isNft === true;
      const isErc1155 =
        (event.tokenStandard || asset?.tokenStandard) === 'ERC-1155';
      const amount = isNft && !isErc1155 ? '1' : uint(event.value);
      const decimals = knownPrecision(asset?.decimals ?? event.decimals);
      const hasDecimals = decimals !== undefined;
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
          : formatTokenUnits(parseErc20Units(BigInt(amount)), decimals!);
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
        ...(amount === undefined ? { amountUnavailable: true } : {}),
      };
    }
    // Event amounts are never native payment amounts. Invalid event identity
    // cannot authorize a recipient or fall through to native interpretation.
    return {
      actualRecipient: '',
      displaySymbol: 'TOKEN',
      displayValue: '?',
      formattedValue: '?',
      isErc20Transfer: true,
      isNft: false,
      amountUnavailable: true,
    };
  }

  const isTokenTx = isTokenTransfer(tx);
  if (isTokenTx) {
    const isErc1155Tx = isERC1155Transfer(tx);
    const tokenValue = isErc1155Tx
      ? getERC1155TransferValue(tx)
      : getERC20TransferValue(tx);
    const tokenAddress = tx.to;
    const actualRecipient = isErc1155Tx
      ? getERC1155Recipient(tx)
      : getERC20Recipient(tx);
    const tokenId = isErc1155Tx ? getERC1155TokenId(tx) : getERC721TokenId(tx);
    if (tokenValue !== null && tokenValue !== undefined && tokenAddress) {
      try {
        const transactionChainId = Number(tx.chainId ?? context.chainId);
        const token = context.assets?.find(
          (asset) =>
            Number(asset.chainId) === transactionChainId &&
            asset.contractAddress?.toLowerCase() === tokenAddress.toLowerCase()
        );
        if (token) {
          const display = knownTokenDisplay(
            token,
            tokenValue,
            isErc1155Tx,
            actualRecipient,
            tokenAddress,
            tokenId
          );
          if (display) return display;
        }
        if (
          !token &&
          context.lookupToken &&
          transactionChainId === Number(context.chainId)
        ) {
          try {
            const details = await context.lookupToken(tokenAddress);
            if (details) {
              const display = knownTokenDisplay(
                details,
                tokenValue,
                isErc1155Tx,
                actualRecipient,
                tokenAddress,
                tokenId
              );
              if (display) return display;
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

  // Preserve native integer input exactly. Missing/unsafe values are unknown, not zero.
  let value: unknown = tx.value;
  if (value && typeof value === 'object') {
    const object = value as { _hex?: unknown; hex?: unknown };
    if (typeof object.hex === 'string') value = object.hex;
    else if (typeof object._hex === 'string') value = object._hex;
  }
  let exact: string | undefined;
  try {
    if (
      typeof value === 'number' &&
      (!Number.isSafeInteger(value) || value < 0)
    )
      throw new Error('Invalid amount');
    if (
      typeof value === 'string' &&
      !/^(?:[0-9]{1,78}|0x[0-9a-f]{1,64})$/i.test(value)
    )
      throw new Error('Invalid amount');
    if (
      typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'bigint'
    )
      throw new Error('Invalid amount');
    exact = formatTokenUnits(parseErc20Units(BigInt(value)), 18).replace(
      /\.0$/,
      ''
    );
  } catch {
    /* Unavailable is kept distinct from a legitimate zero. */
  }
  return {
    displayValue: exact ?? '?',
    formattedValue: exact ?? '?',
    displaySymbol: currency.toUpperCase(),
    isErc20Transfer: false,
    actualRecipient: tx.to || '',
    isNft: false,
    ...(exact === undefined ? { amountUnavailable: true as const } : {}),
  };
};

export const isERC1155Transfer = (tx: EvmDisplayTransaction) => {
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

export const isERC20Transfer = (tx: EvmDisplayTransaction) => {
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

export const isTokenTransfer = (tx: EvmDisplayTransaction) =>
  isERC20Transfer(tx) || isERC1155Transfer(tx);

export const getERC20TransferValue = (tx: EvmDisplayTransaction) => {
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

export const getERC721TokenId = (tx: EvmDisplayTransaction): string | null => {
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

export const getERC20Recipient = (tx: EvmDisplayTransaction): string | null => {
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

export const getERC1155TransferValue = (tx: EvmDisplayTransaction) => {
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

export const getERC1155TokenId = (tx: EvmDisplayTransaction): string | null => {
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
  tx: EvmDisplayTransaction
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
