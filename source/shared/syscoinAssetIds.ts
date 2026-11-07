/** Blockbook serializes SPT and NFT asset identifiers as positive uint64s. */
export function parseSyscoinAssetGuid(value: unknown): string | undefined {
  const text =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return typeof text === 'string' &&
    /^[1-9][0-9]{0,19}$/.test(text) &&
    (text.length < 20 || text <= '18446744073709551615')
    ? text
    : undefined;
}

/** Canonical Syscoin native bridge asset identifier; independent of display assets. */
export const SYSX_ASSET_GUID = '123456';
export const SYSX_ASSET_DECIMALS = 8;
