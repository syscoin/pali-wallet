import type { CSSProperties } from 'react';

/**
 * Normalizes Syscoin transaction types from various formats into a consistent format
 * Handles:
 * - syscointx-js format: 'assetallocation_send' (with underscores)
 * - Non-underscored format: 'assetallocationsend'
 * - SPT-prefixed format: 'SPTAssetAllocationSend'
 * - Mixed formats from different sources
 */
export const normalizeSyscoinTransactionType = (
  tokenType: string | undefined
): string | undefined => {
  if (!tokenType) return undefined;

  // First, normalize to lowercase and remove underscores
  const normalized = tokenType.toLowerCase().replace(/_/g, '');

  // Map all variations to a consistent normalized format
  const typeMap: { [key: string]: string } = {
    // Asset allocation send variations
    assetallocationsend: 'assetallocationsend',
    sptassetallocationsend: 'assetallocationsend',

    // Syscoin burn to allocation variations
    syscoinburntoallocation: 'syscoinburntoallocation',
    sptsyscoinburntoassetallocation: 'syscoinburntoallocation',

    // Asset allocation burn to syscoin variations
    assetallocationburntosyscoin: 'assetallocationburntosyscoin',
    sptassetallocationburntosyscoin: 'assetallocationburntosyscoin',

    // Asset allocation burn to ethereum/NEVM variations
    assetallocationburntoethereum: 'assetallocationburntoethereum',
    sptassetallocationburntonevm: 'assetallocationburntoethereum',

    // Asset allocation mint variations
    assetallocationmint: 'assetallocationmint',
    sptassetallocationmint: 'assetallocationmint',

    // NEVM data variations
    nevmdata: 'nevmdata',
  };

  return typeMap[normalized] || undefined;
};

/**
 * Gets a human-readable label for a normalized transaction type
 */
export const getSyscoinTransactionTypeLabel = (
  tokenType: string | undefined
): string => {
  const normalized = normalizeSyscoinTransactionType(tokenType);

  switch (normalized) {
    case 'assetallocationsend':
      return 'SPT Transfer';
    case 'syscoinburntoallocation':
      return 'SYS → SYSX';
    case 'assetallocationburntosyscoin':
      return 'SYSX → SYS';
    case 'assetallocationburntoethereum':
      return 'Bridge to NEVM';
    case 'assetallocationmint':
      return 'Mint from NEVM';
    case 'nevmdata':
      return 'NEVM Data';
    default:
      return 'Transaction';
  }
};

/**
 * Gets styling information for a normalized transaction type
 */
export const getSyscoinTransactionTypeStyle = (
  tokenType: string | undefined
): {
  bgColor: string;
  bgStyle?: CSSProperties;
  icon: string;
  label: string;
  textColor: string;
} => {
  const normalized = normalizeSyscoinTransactionType(tokenType);

  switch (normalized) {
    case 'assetallocationsend':
      return {
        label: 'SPT Transfer',
        bgColor: 'bg-blue-500',
        textColor: 'text-white',
        icon: '↗️',
        bgStyle: { backgroundColor: 'rgba(59, 130, 246, 0.2)' }, // blue-500 with 20% opacity
      };
    case 'syscoinburntoallocation':
      return {
        label: 'SYS → SYSX',
        bgColor: 'bg-orange-500',
        textColor: 'text-white',
        icon: '🔥',
        bgStyle: { backgroundColor: 'rgba(249, 115, 22, 0.2)' }, // orange-500 with 20% opacity
      };
    case 'assetallocationburntosyscoin':
      return {
        label: 'SYSX → SYS',
        bgColor: 'bg-green-500',
        textColor: 'text-white',
        icon: '💰',
        bgStyle: { backgroundColor: 'rgba(34, 197, 94, 0.2)' }, // green-500 with 20% opacity
      };
    case 'assetallocationburntoethereum':
      return {
        label: 'Bridge to NEVM',
        bgColor: 'bg-purple-500',
        textColor: 'text-white',
        icon: '🌉',
        bgStyle: { backgroundColor: 'rgba(168, 85, 247, 0.2)' }, // purple-500 with 20% opacity
      };
    case 'assetallocationmint':
      return {
        label: 'Mint from NEVM',
        bgColor: 'bg-yellow-500',
        textColor: 'text-white',
        icon: '⚡',
        bgStyle: { backgroundColor: 'rgba(234, 179, 8, 0.2)' }, // yellow-500 with 20% opacity
      };
    case 'nevmdata':
      return {
        label: 'NEVM Data',
        bgColor: 'bg-indigo-500',
        textColor: 'text-white',
        icon: '📊',
        bgStyle: { backgroundColor: 'rgba(99, 102, 241, 0.2)' }, // indigo-500 with 20% opacity
      };
    default:
      return {
        label: 'Transaction',
        bgColor: 'bg-gray-500',
        textColor: 'text-white',
        icon: '💱',
        bgStyle: { backgroundColor: 'rgba(107, 114, 128, 0.2)' }, // gray-500 with 20% opacity
      };
  }
};

/**
 * Checks if a transaction type is a mint or burn transaction
 * These transactions display the intent amount (first output) differently
 */
export const isMintOrBurnTransaction = (
  tokenType: string | undefined
): boolean => {
  const normalized = normalizeSyscoinTransactionType(tokenType);

  return (
    normalized === 'assetallocationmint' ||
    normalized === 'assetallocationburntoethereum' ||
    normalized === 'assetallocationburntosyscoin' ||
    normalized === 'syscoinburntoallocation'
  );
};
