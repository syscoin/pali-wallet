import { BigNumber } from '../utils/ethersV6Compat.ts';

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
  const atomic = (value: unknown) =>
    (typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value))) &&
    /^\d+$/.test(String(value));
  if (
    !atomic(transaction?.addressValueIn) ||
    !atomic(transaction?.addressValueOut)
  )
    return null;
  return BigNumber.from(String(transaction.addressValueOut))
    .sub(String(transaction.addressValueIn))
    .toString();
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
