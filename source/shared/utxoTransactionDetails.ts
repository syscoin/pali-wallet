import {
  detailFollowsUtxoSummary,
  type UtxoSummaryObservation,
} from './utxoDetailFreshness.ts';
import {
  isSyscoinTokenOperation,
  normalizeSyscoinTransactionType,
} from './utxoNativeAmounts.ts';
import { mergeAccountOwnershipFlags } from './utxoTransactionDetailCache.ts';
import type {
  ITransactionInfoUtxo,
  ITransactionVin,
  ITransactionVout,
} from '../types/utxoTransaction.ts';

// Both provider string quantities and existing SDK numeric declarations are
// accepted structurally; the shared amount helpers still validate exact values.
export type UtxoDetailTransaction = Omit<
  ITransactionInfoUtxo,
  'vin' | 'vout'
> & {
  vin: Array<Omit<ITransactionVin, 'value'> & { value: string | number }>;
  vout: Array<Omit<ITransactionVout, 'value'> & { value: string | number }>;
};

// Source script addresses are not identities or account-ownership claims.
export const getSendingAddresses = (
  transaction: UtxoDetailTransaction
): string[] => {
  const addresses = new Set<string>();
  for (const input of Array.isArray(transaction.vin) ? transaction.vin : []) {
    if (input?.isAddress === false || !Array.isArray(input?.addresses))
      continue;
    for (const address of input.addresses)
      if (
        typeof address === 'string' &&
        address.length > 0 &&
        !/^OP_/i.test(address) &&
        !/\s/.test(address)
      )
        addresses.add(address);
  }
  return [...addresses];
};

// These are receiving output destinations, not a guess at the original intent.
export const getReceivingAddresses = (
  transaction: UtxoDetailTransaction
): string[] => {
  const kind = normalizeSyscoinTransactionType(transaction.tokenType);
  const isToken = isSyscoinTokenOperation(transaction);
  if (
    isToken &&
    ![
      'assetallocationmint',
      'assetallocationsend',
      'syscoinburntoallocation',
      'assetallocationburntosyscoin',
    ].includes(kind ?? '')
  )
    return []; // A NEVM burn's remaining UTXO change is not its recipient.

  const positiveAtomic = (value: unknown) =>
    (typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value))) &&
    /^\d+$/.test(String(value)) &&
    /[1-9]/.test(String(value));
  const positiveAsset = (
    assetInfo: UtxoDetailTransaction['vout'][number]['assetInfo']
  ) => {
    if (assetInfo?.value !== undefined) return positiveAtomic(assetInfo.value);
    const formatted =
      typeof assetInfo?.valueStr === 'string' &&
      assetInfo.valueStr.trim().match(/^(\d+(?:\.\d*)?|\.\d+)(?:\s+[\s\S]+)?$/);
    return Boolean(formatted && /[1-9]/.test(formatted[1]!));
  };
  const assetCredit = isToken && kind !== 'assetallocationburntosyscoin';
  const addresses = new Set<string>();
  for (const output of Array.isArray(transaction.vout)
    ? transaction.vout
    : []) {
    if (
      output?.isAddress === false ||
      /^(?:0x)?6a/i.test(output?.hex ?? '') ||
      (assetCredit && !positiveAtomic(output?.assetInfo?.assetGuid)) ||
      !(assetCredit
        ? positiveAsset(output?.assetInfo)
        : positiveAtomic(output?.value)) ||
      !Array.isArray(output?.addresses)
    )
      continue;
    for (const address of output.addresses)
      if (
        typeof address === 'string' &&
        address.length > 0 &&
        !/^OP_/i.test(address) &&
        !/\s/.test(address)
      )
        addresses.add(address);
  }
  return [...addresses];
};

export const mergeAccountSummaryWithFullTransaction = <
  T extends UtxoDetailTransaction
>(
  accountTransaction: T | undefined,
  fullTransaction: T,
  summaryObservation: UtxoSummaryObservation | undefined
): T => {
  if (!accountTransaction) return fullTransaction;
  // Reopening a cached body is not a new summary observation. A real new
  // summary can change placement in either direction, at any confirmation count.
  const statusTransaction =
    summaryObservation !== undefined &&
    detailFollowsUtxoSummary(fullTransaction, summaryObservation)
      ? fullTransaction
      : accountTransaction;

  return {
    ...fullTransaction,
    tokenType: fullTransaction.tokenType ?? accountTransaction.tokenType,
    tokenTransfers:
      fullTransaction.tokenTransfers ?? accountTransaction.tokenTransfers,
    accountAssetTransfers: accountTransaction.accountAssetTransfers,
    addressValueIn: accountTransaction.addressValueIn,
    addressValueOut: accountTransaction.addressValueOut,
    blockHash: statusTransaction.blockHash,
    blockHeight: statusTransaction.blockHeight,
    blockTime: statusTransaction.blockTime,
    confirmations: statusTransaction.confirmations,
    confirmationETABlocks: statusTransaction.confirmationETABlocks,
    confirmationETASeconds: statusTransaction.confirmationETASeconds,
    direction: accountTransaction.direction,
    vin: mergeAccountOwnershipFlags(
      accountTransaction.vin,
      fullTransaction.vin
    ) as T['vin'],
    vout: mergeAccountOwnershipFlags(
      accountTransaction.vout,
      fullTransaction.vout
    ) as T['vout'],
  };
};
