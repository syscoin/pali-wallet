import {
  IAssetInfo,
  ITransactionInfoUtxo,
  ITransactionVin,
  ITransactionVout,
} from 'types/useTransactionsInfo';

import { formatSyscoinValue } from './formatSyscoinValue';
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
 * Common helper to parse asset values from various formats
 */
const parseAssetValue = (assetInfo: IAssetInfo, decimals?: number): number => {
  if (!assetInfo) return 0;

  // Handle string format with potential symbol
  if (assetInfo.valueStr) {
    const valueStr = assetInfo.valueStr;
    const numericValue = parseFloat(valueStr.split(' ')[0]);
    return isNaN(numericValue) ? 0 : numericValue;
  }

  // Handle raw numeric value
  if (assetInfo.value !== undefined) {
    const formatted = formatSyscoinValue(
      assetInfo.value.toString(),
      typeof decimals === 'number' ? decimals : 8
    );
    return parseFloat(formatted);
  }

  return 0;
};

/**
 * Unified function to get intent amount and asset from any Syscoin transaction
 * Handles both decoded transactions and raw transactions with vin/vout
 * Simple rules:
 * - ALLOCATION_BURN_TO_ETHEREUM/SYSCOIN: Asset amount from OP_RETURN
 * - SYSCOIN_BURN_TO_ALLOCATION: SYS amount from OP_RETURN (returns SYSX guid: 123456)
 * - ALLOCATION_MINT: Net amount (output - input) for asset
 * - ALLOCATION_SEND & others: First asset output value
 * @param transaction - Transaction (decoded or raw with vin/vout)
 * @returns Object with amount and assetGuid, or null if no intent found
 */
export const getSyscoinIntentAmount = (
  transaction: ITransactionInfoUtxo
): { amount: number; decimals?: number; symbol?: string } | null => {
  if (!transaction) {
    return null;
  }

  // Determine transaction type - support both decoded and raw formats
  const txType = transaction.tokenType;
  const normalizedType = normalizeSyscoinTransactionType(txType);

  // Modern format with vin/vout containing assetInfo (or raw transaction)
  // Normalize to arrays to guard against API variants that return objects or singletons
  const toArray = (val: any): any[] => {
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object') return Object.values(val);
    return [];
  };
  const vout = toArray(transaction.vout);
  const vin = toArray(transaction.vin);

  // Build decimals map from tokenTransfers if present
  const decimalsByGuid = new Map<string, number>();
  const symbolByGuid = new Map<string, string>();
  const transfers = Array.isArray(transaction.tokenTransfers)
    ? transaction.tokenTransfers
    : [];
  for (const t of transfers) {
    const guid = t?.token || t?.assetGuid;
    const d = t?.decimals;
    const s = t?.symbol;
    if (guid && typeof d === 'number') {
      decimalsByGuid.set(guid, d);
    }
    if (guid && typeof s === 'string' && s) {
      symbolByGuid.set(guid, s);
    }
  }

  // SYSCOIN_BURN_TO_ALLOCATION: SYS amount from OP_RETURN (burning SYS to get SYSX)
  if (normalizedType === 'syscoinburntoallocation') {
    const opReturn = vout.find((v: ITransactionVout) =>
      v.addresses?.[0]?.startsWith('OP_RETURN')
    );

    if (opReturn?.value) {
      const formatted = formatSyscoinValue(opReturn.value.toString());
      return {
        amount: parseFloat(formatted),
        decimals: 8,
        symbol: 'SYSX',
      };
    }
    return null;
  }

  // ALLOCATION_BURN_TO_ETHEREUM/SYSCOIN: Asset amount from OP_RETURN
  if (
    normalizedType === 'assetallocationburntoethereum' ||
    normalizedType === 'assetallocationburntosyscoin'
  ) {
    const opReturn = vout.find((v: ITransactionVout) =>
      v.addresses?.[0]?.startsWith('OP_RETURN')
    );

    if (opReturn?.assetInfo) {
      const guid = opReturn.assetInfo.assetGuid;
      const dec = decimalsByGuid.get(guid);
      return {
        amount: parseAssetValue(opReturn.assetInfo, dec),
        decimals: dec,
        symbol: symbolByGuid.get(guid),
      };
    }
    return null;
  }

  // ALLOCATION_MINT: Net amount (output - input) for asset
  if (normalizedType === 'assetallocationmint') {
    // Calculate outputs per asset
    const outputAssets = new Map<string, number>();
    vout.forEach((v: ITransactionVout) => {
      if (v.assetInfo) {
        const guid = v.assetInfo.assetGuid;
        const current = outputAssets.get(guid) || 0;
        const dec = decimalsByGuid.get(guid);
        outputAssets.set(guid, current + parseAssetValue(v.assetInfo, dec));
      }
    });

    // Calculate inputs per asset
    const inputAssets = new Map<string, number>();
    vin.forEach((v: ITransactionVin) => {
      if (v.assetInfo) {
        const guid = v.assetInfo.assetGuid;
        const current = inputAssets.get(guid) || 0;
        const dec = decimalsByGuid.get(guid);
        inputAssets.set(guid, current + parseAssetValue(v.assetInfo, dec));
      }
    });

    // Find asset with output > input and return the net
    for (const [guid, outputAmount] of outputAssets.entries()) {
      const inputAmount = inputAssets.get(guid) || 0;
      if (outputAmount > inputAmount) {
        // Net amount already in decimal units; carry decimals if known
        return {
          amount: outputAmount - inputAmount,
          decimals: decimalsByGuid.get(guid),
          symbol: symbolByGuid.get(guid),
        };
      }
    }

    return null;
  }

  // ALLOCATION_SEND and similar: compute NET asset delta for the current user.
  // Sum owned inputs (spent) and owned outputs (received) per assetGuid.
  // Only show SPT intent when net != 0; otherwise treat as native SYS-only send.
  const toNumber = (info: IAssetInfo | undefined): number => {
    if (!info) return 0;
    const dec = decimalsByGuid.get(info.assetGuid);
    return parseAssetValue(info, dec);
  };

  const sumByGuid = (items: (ITransactionVin | ITransactionVout)[]) => {
    const map = new Map<string, number>();
    for (const it of items) {
      if (!it || it.isOwn !== true || !it.assetInfo) continue;
      const guid = it.assetInfo.assetGuid;
      const prev = map.get(guid) || 0;
      const val = toNumber(it.assetInfo);
      map.set(guid, prev + val);
    }
    return map;
  };

  const ownedInputs = sumByGuid(vin as any);
  const ownedOutputs = sumByGuid(vout as any);

  // Build union of guids
  const allGuids = new Set<string>([
    ...ownedInputs.keys(),
    ...ownedOutputs.keys(),
  ]);

  let bestGuid: string | null = null;
  let bestAbsNet = 0;
  let bestNet = 0;
  for (const guid of allGuids) {
    const outVal = ownedOutputs.get(guid) || 0;
    const inVal = ownedInputs.get(guid) || 0;
    const net = outVal - inVal; // positive => net received, negative => net sent
    const absNet = Math.abs(net);
    if (absNet > bestAbsNet) {
      bestAbsNet = absNet;
      bestNet = net;
      bestGuid = guid;
    }
  }

  if (bestGuid && bestAbsNet > 0) {
    const dec = decimalsByGuid.get(bestGuid);
    return {
      amount: Math.abs(bestNet),
      decimals: dec,
      symbol: symbolByGuid.get(bestGuid),
    };
  }

  return null;
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
