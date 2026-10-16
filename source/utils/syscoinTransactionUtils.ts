import {
  IAssetInfo,
  ITransactionInfoUtxo,
  ITransactionVin,
  ITransactionVout,
} from 'types/useTransactionsInfo';
import { BigNumber } from 'utils/ethersV6Compat';

import { formatSyscoinValue } from './formatSyscoinValue';
import type { CSSProperties } from 'react';

/** Absolute native balance change for the account queried by Blockbook. */
export const getSyscoinAccountDelta = (transaction: {
  addressValueIn?: string;
  addressValueOut?: string;
}): string | null => {
  if (
    transaction?.addressValueIn === undefined &&
    transaction?.addressValueOut === undefined
  ) {
    return null;
  }

  try {
    const valueIn = BigNumber.from(String(transaction?.addressValueIn ?? '0'));
    const valueOut = BigNumber.from(
      String(transaction?.addressValueOut ?? '0')
    );
    return valueIn.gte(valueOut)
      ? valueIn.sub(valueOut).toString()
      : valueOut.sub(valueIn).toString();
  } catch {
    return null;
  }
};

/** Signed native account movement, independent of the token operation direction. */
export const getSyscoinAccountChange = (transaction: {
  addressValueIn?: string;
  addressValueOut?: string;
}): string | null => {
  if (getSyscoinAccountDelta(transaction) === null) return null;
  return BigNumber.from(String(transaction?.addressValueOut ?? '0'))
    .sub(String(transaction?.addressValueIn ?? '0'))
    .toString();
};

export const formatSyscoinConfirmationETA = (transaction: {
  confirmationETASeconds?: number;
}): string | null => {
  const seconds = Number(transaction?.confirmationETASeconds ?? 0);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  if (seconds < 60) {
    return `${Math.ceil(seconds)} sec`;
  }

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) {
    return `${hours} hr`;
  }

  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};

const getTransferDecimals = (transfer: any) =>
  typeof transfer?.decimals === 'number' && transfer.decimals >= 0
    ? Math.floor(transfer.decimals)
    : 8;

const getAbsoluteRawTransferValue = (transfer: any) => {
  try {
    const value = String(transfer?.value ?? '0');
    return BigNumber.from(value.startsWith('-') ? value.slice(1) : value);
  } catch {
    return BigNumber.from(0);
  }
};

const compareNormalizedTransferValues = (a: any, b: any) => {
  const aDecimals = getTransferDecimals(a);
  const bDecimals = getTransferDecimals(b);
  const aValue = getAbsoluteRawTransferValue(a).mul(
    BigNumber.from(10).pow(bDecimals)
  );
  const bValue = getAbsoluteRawTransferValue(b).mul(
    BigNumber.from(10).pow(aDecimals)
  );

  if (aValue.gt(bValue)) return 1;
  if (aValue.lt(bValue)) return -1;
  return 0;
};

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
  if (typeof tokenType !== 'string' || !tokenType) return undefined;

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
  transaction: Pick<
    ITransactionInfoUtxo,
    'accountAssetTransfers' | 'tokenTransfers' | 'tokenType'
  > & {
    vin?: Pick<ITransactionVin, 'assetInfo' | 'isOwn'>[];
    vout?: Pick<ITransactionVout, 'addresses' | 'assetInfo' | 'isOwn'>[];
  }
): {
  amount: number;
  assetGuid?: string;
  decimals?: number;
  symbol?: string;
} | null => {
  if (!transaction) {
    return null;
  }

  // Determine transaction type - support both decoded and raw formats
  const txType = transaction.tokenType;
  const normalizedType = normalizeSyscoinTransactionType(txType);
  const accountTransfers = Array.isArray(
    (transaction as any).accountAssetTransfers
  )
    ? (transaction as any).accountAssetTransfers
    : [];
  if (accountTransfers.length > 0) {
    const transfer = accountTransfers.reduce((selected, current) =>
      compareNormalizedTransferValues(current, selected) > 0
        ? current
        : selected
    );
    const value = transfer?.value;
    const amount =
      value !== undefined
        ? parseFloat(
            formatSyscoinValue(
              getAbsoluteRawTransferValue(transfer).toString(),
              typeof transfer?.decimals === 'number' ? transfer.decimals : 8
            )
          )
        : 0;
    if (amount > 0) {
      return {
        amount,
        assetGuid: transfer?.token || transfer?.assetGuid,
        decimals: transfer?.decimals,
        symbol: transfer?.symbol,
      };
    }
  }

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
        assetGuid: guid,
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
          assetGuid: guid,
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
      assetGuid: bestGuid,
      decimals: dec,
      symbol: symbolByGuid.get(bestGuid),
    };
  }

  return null;
};

/** Token-operation values are separate from native funding/account deltas. */
export const isSyscoinTokenOperation = (transaction: any): boolean => {
  const kind = normalizeSyscoinTransactionType(transaction?.tokenType);
  return Boolean(
    (kind && kind !== 'nevmdata') ||
      transaction?.accountAssetTransfers?.length ||
      transaction?.tokenTransfers?.length ||
      [transaction?.vin, transaction?.vout].some(
        (entries) =>
          Array.isArray(entries) && entries.some((entry) => entry?.assetInfo)
      )
  );
};

/**
 * A native transfer/output value, not the account's fee-inclusive balance delta.
 * Compact value/valueIn are account aliases; only full input/output arrays can
 * prove that a spend is wholly funded by this account.
 */
export const getSyscoinNativeTransferAmount = (
  account: any,
  full: any = account
): {
  amount: string;
  direction?: 'sent' | 'received';
  kind: 'external' | 'received' | 'self';
  outputTotal?: boolean;
} | null => {
  if (
    typeof account?.txid !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(account.txid) ||
    typeof full?.txid !== 'string' ||
    full.txid.toLowerCase() !== account.txid.toLowerCase() ||
    isSyscoinTokenOperation(account) ||
    isSyscoinTokenOperation(full)
  )
    return null;
  const atomic = (value: unknown) => {
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !/^\d+$/.test(String(value))
    )
      throw new Error('Invalid native transaction amount');
    return BigNumber.from(String(value));
  };
  try {
    const accountIn = atomic(account.addressValueIn);
    const accountOut = atomic(account.addressValueOut);
    if (accountIn.isZero()) {
      return accountOut.gt(0)
        ? {
            amount: accountOut.toString(),
            direction: 'received',
            kind: 'received',
          }
        : null;
    }
    if (
      !Array.isArray(full.vin) ||
      !full.vin.length ||
      !Array.isArray(full.vout) ||
      !full.vout.length
    )
      return null;
    // Equality of positive input totals proves none belongs to another account.
    // A foreign zero-value input would not affect that equality, so leave such
    // collaborative/ambiguous records unavailable rather than claiming ownership.
    if (full.vin.some((entry: any) => atomic(entry?.value).isZero()))
      return null;
    const sum = (entries: any[]) =>
      entries.reduce(
        (total, entry) => total.add(atomic(entry?.value)),
        BigNumber.from(0)
      );
    const inputTotal = sum(full.vin);
    const outputTotal = sum(full.vout);
    const fee = atomic(full.fees ?? account.fees);
    if (
      !accountIn.eq(inputTotal) ||
      accountOut.gt(outputTotal) ||
      outputTotal.lte(0) ||
      !outputTotal.add(fee).eq(inputTotal)
    )
      return null;
    const external = outputTotal.sub(accountOut);
    return external.gt(0)
      ? { amount: external.toString(), direction: 'sent', kind: 'external' }
      : {
          amount: outputTotal.toString(),
          kind: 'self',
          outputTotal:
            full.vout.filter((entry: any) => atomic(entry.value).gt(0)).length >
            1,
        };
  } catch {
    return null;
  }
};

export const getSyscoinOperationAmount = (
  transaction: any
):
  | (NonNullable<ReturnType<typeof getSyscoinIntentAmount>> & {
      direction?: 'sent' | 'received';
      scope: 'transaction' | 'account';
    })
  | null => {
  if (!isSyscoinTokenOperation(transaction)) return null;
  const kind = normalizeSyscoinTransactionType(transaction?.tokenType);
  const bridge = kind && kind !== 'assetallocationsend' && kind !== 'nevmdata';
  if (bridge) {
    // Full bridge burn/mint semantics take precedence over an account's funding
    // or asset delta. Do not select an arbitrary asset from a multi-asset record.
    const outputs = Array.isArray(transaction?.vout) ? transaction.vout : [];
    const assetBurn =
      kind === 'assetallocationburntoethereum' ||
      kind === 'assetallocationburntosyscoin';
    const nativeBurn = kind === 'syscoinburntoallocation';
    const relevantOutputs =
      assetBurn || nativeBurn
        ? outputs.filter(
            (output: any) =>
              typeof output?.addresses?.[0] === 'string' &&
              output.addresses[0].startsWith('OP_RETURN') &&
              (!assetBurn || output.assetInfo)
          )
        : outputs;
    if ((assetBurn || nativeBurn) && relevantOutputs.length !== 1) return null;
    const assets = new Set<string>();
    for (const output of relevantOutputs)
      if (output?.assetInfo?.assetGuid)
        assets.add(String(output.assetInfo.assetGuid));
    if (assets.size <= 1) {
      const operation = getSyscoinIntentAmount({
        ...transaction,
        vout: relevantOutputs,
        accountAssetTransfers: [],
        // Account metadata can describe precision/symbol without implying that
        // the account owns the transaction-wide burned or minted asset.
        tokenTransfers: [
          ...(Array.isArray(transaction.accountAssetTransfers)
            ? transaction.accountAssetTransfers
            : []),
          ...(Array.isArray(transaction.tokenTransfers)
            ? transaction.tokenTransfers
            : []),
        ],
      });
      if (operation && operation.amount > 0)
        return { ...operation, scope: 'transaction' as const };
    }
    return null;
  }
  // Ordinary allocation transfers use the relevant account asset, not a
  // transaction-wide first output or the native funding account's direction.
  const account = getSyscoinIntentAmount(transaction);
  if (account && account.amount > 0) {
    let direction: 'sent' | 'received' | undefined;
    const transfers = Array.isArray(transaction.accountAssetTransfers)
      ? transaction.accountAssetTransfers
      : [];
    if (transfers.length) {
      const transfer = transfers.reduce((selected: any, current: any) =>
        compareNormalizedTransferValues(current, selected) > 0
          ? current
          : selected
      );
      if (transfer.direction === 'sent' || transfer.direction === 'received')
        direction = transfer.direction;
    }
    if (!direction) {
      // Blockbook compact accountAssetTransfers contains absolute values. Its
      // positive amount (and the native funding direction) says nothing about
      // whether this account sent or received the asset.
      const ownedAmount = (entries: any) =>
        Array.isArray(entries)
          ? entries.reduce(
              (total: number, entry: any) =>
                entry?.isOwn === true &&
                entry?.assetInfo?.assetGuid === account.assetGuid
                  ? total + parseAssetValue(entry.assetInfo, account.decimals)
                  : total,
              0
            )
          : 0;
      const net = ownedAmount(transaction.vout) - ownedAmount(transaction.vin);
      if (net !== 0) direction = net < 0 ? 'sent' : 'received';
    }
    return { ...account, direction, scope: 'account' };
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
