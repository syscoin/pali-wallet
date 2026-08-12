const SYSCOIN_BUILDER_DECIMALS = 8;
type AssetType = 'SYSX' | 'ERC20' | 'ERC721' | 'ERC1155';

const normalizeDecimals = (decimals: number): number => {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > SYSCOIN_BUILDER_DECIMALS
  ) {
    throw new Error('Asset decimals must be an integer between 0 and 8');
  }

  return decimals;
};

const parseAssetAmount = (
  amount: string,
  decimals: number,
  allowZero = false,
  assetType?: AssetType
): bigint => {
  const normalizedDecimals = normalizeDecimals(decimals);
  const normalizedAmount = String(amount).trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalizedAmount);

  if (!match) {
    throw new Error('Amount must be a positive decimal number');
  }
  if (match[1].length > 20) {
    throw new Error('Amount is too large');
  }

  const fraction = match[2] || '';
  if (fraction.length > normalizedDecimals) {
    throw new Error(
      `Amount supports at most ${normalizedDecimals} decimal places`
    );
  }

  const rawAmount = BigInt(
    `${match[1]}${fraction.padEnd(normalizedDecimals, '0')}`
  );
  if (rawAmount < BigInt(0) || (!allowZero && rawAmount === BigInt(0))) {
    throw new Error('Amount must be greater than zero');
  }
  if (assetType === 'ERC721' && rawAmount !== BigInt(1)) {
    throw new Error('ERC721 transfers require exactly one token');
  }

  return rawAmount;
};

export const assertValidAssetAmount = (
  amount: string,
  decimals: number,
  assetType?: AssetType
): void => {
  parseAssetAmount(amount, decimals, false, assetType);
};

export const isAssetAmountWithinBalance = (
  amount: string,
  balance: string,
  decimals: number
): boolean => {
  try {
    return (
      parseAssetAmount(amount, decimals) <=
      parseAssetAmount(balance, decimals, true)
    );
  } catch {
    return false;
  }
};

export const hasNonZeroAssetDelta = (
  amount: number | string | undefined
): boolean => {
  if (amount === undefined) return false;

  const normalizedAmount = String(amount).trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedAmount)) return false;

  return !/^-?0*(?:\.0*)?$/.test(normalizedAmount);
};

/**
 * The installed keyring API accepts asset amounts in an eight-decimal display
 * format. Convert the selected asset's display precision into that exact
 * format without passing through Number; the keyring then reconstructs the
 * intended raw UTXO asset units.
 */
export const toEightDecimalBuilderAmount = (
  amount: string,
  decimals: number,
  assetType?: AssetType
): string => {
  const rawAmount = parseAssetAmount(
    amount,
    decimals,
    false,
    assetType
  ).toString();
  const padded = rawAmount.padStart(SYSCOIN_BUILDER_DECIMALS + 1, '0');

  return `${padded.slice(0, -SYSCOIN_BUILDER_DECIMALS)}.${padded.slice(
    -SYSCOIN_BUILDER_DECIMALS
  )}`;
};
