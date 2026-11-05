import { BigNumber, formatUnits, parseUnits } from '../utils/ethersV6Compat.ts';

import { SYSX_ASSET_GUID } from './syscoinAssetIds.ts';
import {
  normalizeSyscoinTransactionType,
  isSyscoinTokenOperation,
} from './utxoNativeAmounts.ts';
import type {
  IAssetInfo,
  ITransactionInfoUtxo,
  ITransactionVin,
  ITransactionVout,
} from '../types/useTransactionsInfo.ts';

/** SPT/UTXO asset precision is 0..8, as in the existing PSBT review boundary. */
const MAX_DECIMALS = 8;
const MAX_DIGITS = 78;
const ZERO = BigNumber.from(0);
const invalid = (): never => {
  throw new Error('Invalid SPT amount');
};
const checkedDecimals = (value: unknown): number =>
  value === undefined || value === null
    ? 8
    : typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_DECIMALS
    ? value
    : invalid();
const getTransferDecimals = (transfer: any) =>
  checkedDecimals(transfer?.decimals);
function integer(value: unknown): BigNumber {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid();
    value = String(value);
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_DIGITS + 1 ||
    !/^-?\d{1,78}$/.test(value)
  )
    return invalid();
  return BigNumber.from(value);
}
/** All arithmetic uses a common eight-decimal integer scale, never IEEE-754. */
const rawAssetUnits = (value: unknown, precision: unknown) =>
  integer(value).mul(BigNumber.from(10).pow(8 - checkedDecimals(precision)));
const formatAmount = (value: BigNumber): string =>
  formatUnits(value, 8)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
const positiveAmount = (value: string) =>
  BigNumber.from(parseUnits(value, 8)).gt(0);
function parseAssetValue(info: IAssetInfo, precision?: number): BigNumber {
  const d = checkedDecimals(precision);
  if (info.valueStr) {
    if (typeof info.valueStr !== 'string' || info.valueStr.length > 256)
      return invalid();
    const value = info.valueStr.split(' ')[0];
    if (!/^-?\d{1,78}(?:\.\d{1,8})?$/.test(value)) return invalid();
    return BigNumber.from(parseUnits(value, d)).mul(
      BigNumber.from(10).pow(8 - d)
    );
  }
  return rawAssetUnits(info.value, d);
}
const compareNormalizedTransferValues = (a: any, b: any) => {
  const av = rawAssetUnits(a?.value, getTransferDecimals(a)).abs();
  const bv = rawAssetUnits(b?.value, getTransferDecimals(b)).abs();
  return av.gt(bv) ? 1 : av.lt(bv) ? -1 : 0;
};

/** Existing display precision, with exact decimal rounding instead of Number.toFixed. */
export function formatSyscoinTokenAmount(
  value: string,
  precision = 8
): string | null {
  try {
    const d = checkedDecimals(precision);
    if (
      typeof value !== 'string' ||
      value.length > 256 ||
      !/^\d+(?:\.\d{1,8})?$/.test(value)
    )
      return null;
    const amount = BigNumber.from(parseUnits(value, 8));
    const places =
      amount.gt(0) && amount.lt(10000)
        ? d
        : amount.gt(0) && amount.lt(100000000)
        ? Math.min(d, 6)
        : Math.min(d, 4);
    const divisor = BigNumber.from(10).pow(8 - places);
    const rounded = amount.add(divisor.div(2)).div(divisor);
    const [whole, fraction = ''] = formatUnits(rounded, places).split('.');
    return places ? `${whole}.${fraction.padEnd(places, '0')}` : whole;
  } catch {
    return null;
  }
}

/** Exact decimal text. Display rounding belongs to formatSyscoinTokenAmount. */
export const getSyscoinIntentAmount = (
  transaction: Pick<
    ITransactionInfoUtxo,
    'accountAssetTransfers' | 'tokenTransfers' | 'tokenType'
  > & {
    vin?: Pick<ITransactionVin, 'assetInfo' | 'isOwn'>[];
    vout?: Pick<ITransactionVout, 'addresses' | 'assetInfo' | 'isOwn'>[];
  }
): {
  amount: string;
  assetGuid?: string;
  decimals?: number;
  symbol?: string;
} | null => {
  try {
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
      const amount = rawAssetUnits(
        transfer?.value,
        getTransferDecimals(transfer)
      ).abs();
      if (amount.gt(0)) {
        return {
          amount: formatAmount(amount),
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
        const formatted = formatAmount(rawAssetUnits(opReturn.value, 8));
        return {
          amount: formatted,
          assetGuid: SYSX_ASSET_GUID,
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
          amount: formatAmount(parseAssetValue(opReturn.assetInfo, dec)),
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
      const outputAssets = new Map<string, BigNumber>();
      vout.forEach((v: ITransactionVout) => {
        if (v.assetInfo) {
          const guid = v.assetInfo.assetGuid;
          const current = outputAssets.get(guid) ?? ZERO;
          const dec = decimalsByGuid.get(guid);
          outputAssets.set(
            guid,
            current.add(parseAssetValue(v.assetInfo, dec))
          );
        }
      });

      // Calculate inputs per asset
      const inputAssets = new Map<string, BigNumber>();
      vin.forEach((v: ITransactionVin) => {
        if (v.assetInfo) {
          const guid = v.assetInfo.assetGuid;
          const current = inputAssets.get(guid) ?? ZERO;
          const dec = decimalsByGuid.get(guid);
          inputAssets.set(guid, current.add(parseAssetValue(v.assetInfo, dec)));
        }
      });

      // Find asset with output > input and return the net
      for (const [guid, outputAmount] of outputAssets.entries()) {
        const inputAmount = inputAssets.get(guid) ?? ZERO;
        if (outputAmount.gt(inputAmount)) {
          // Net amount already in decimal units; carry decimals if known
          return {
            amount: formatAmount(outputAmount.sub(inputAmount)),
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
    const toScaledUnits = (info: IAssetInfo | undefined): BigNumber => {
      if (!info) return ZERO;
      const dec = decimalsByGuid.get(info.assetGuid);
      return parseAssetValue(info, dec);
    };

    const sumByGuid = (items: (ITransactionVin | ITransactionVout)[]) => {
      const map = new Map<string, BigNumber>();
      for (const it of items) {
        if (!it || it.isOwn !== true || !it.assetInfo) continue;
        const guid = it.assetInfo.assetGuid;
        const prev = map.get(guid) ?? ZERO;
        const val = toScaledUnits(it.assetInfo);
        map.set(guid, prev.add(val));
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
    let bestAbsNet = ZERO;
    let bestNet = ZERO;
    for (const guid of allGuids) {
      const outVal = ownedOutputs.get(guid) ?? ZERO;
      const inVal = ownedInputs.get(guid) ?? ZERO;
      const net = outVal.sub(inVal); // positive => net received, negative => net sent
      const absNet = net.abs();
      if (absNet.gt(bestAbsNet)) {
        bestAbsNet = absNet;
        bestNet = net;
        bestGuid = guid;
      }
    }

    if (bestGuid && bestAbsNet.gt(0)) {
      const dec = decimalsByGuid.get(bestGuid);
      return {
        amount: formatAmount(bestNet.abs()),
        assetGuid: bestGuid,
        decimals: dec,
        symbol: symbolByGuid.get(bestGuid),
      };
    }

    return null;
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
  try {
    if (!isSyscoinTokenOperation(transaction)) return null;
    const kind = normalizeSyscoinTransactionType(transaction?.tokenType);
    const bridge =
      kind && kind !== 'assetallocationsend' && kind !== 'nevmdata';
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
      if ((assetBurn || nativeBurn) && relevantOutputs.length !== 1)
        return null;
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
        if (operation && positiveAmount(operation.amount))
          return { ...operation, scope: 'transaction' as const };
      }
      return null;
    }
    // Ordinary allocation transfers use the relevant account asset, not a
    // transaction-wide first output or the native funding account's direction.
    const account = getSyscoinIntentAmount(transaction);
    if (account && positiveAmount(account.amount)) {
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
                (total: BigNumber, entry: any) =>
                  entry?.isOwn === true &&
                  entry?.assetInfo?.assetGuid === account.assetGuid
                    ? total.add(
                        parseAssetValue(entry.assetInfo, account.decimals)
                      )
                    : total,
                ZERO
              )
            : ZERO;
        const net = ownedAmount(transaction.vout).sub(
          ownedAmount(transaction.vin)
        );
        if (!net.isZero()) direction = net.lt(0) ? 'sent' : 'received';
      }
      return { ...account, direction, scope: 'account' };
    }
    return null;
  } catch {
    return null;
  }
};

/** Activity can show a known account asset quantity before operation details. */
export const getSyscoinActivityOperationAmount = (
  account: any,
  full: any = account
): ReturnType<typeof getSyscoinOperationAmount> => {
  try {
    const operation = getSyscoinOperationAmount(full);
    if (operation) return operation;
    if (!isSyscoinTokenOperation(account)) return null;
    const transfers = account?.accountAssetTransfers;
    if (!Array.isArray(transfers) || transfers.length !== 1) return null;
    const transfer = transfers[0];
    const guid = transfer?.token || transfer?.assetGuid || transfer?.contract;
    const decimals = transfer?.decimals;
    const raw = transfer?.value;
    if (
      typeof guid !== 'string' ||
      !guid ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 8
    )
      return null;
    const amount = rawAssetUnits(raw, decimals).abs();
    if (!amount.gt(0)) return null;
    return {
      amount: formatAmount(amount),
      assetGuid: guid,
      decimals,
      symbol: typeof transfer.symbol === 'string' ? transfer.symbol : undefined,
      direction:
        transfer.direction === 'sent' || transfer.direction === 'received'
          ? transfer.direction
          : undefined,
      scope: 'account',
    };
  } catch {
    return null;
  }
};
