// Bound regex and integer parsing work while allowing ordinary zero padding.
const MAX_NFT_TOKEN_ID_STRING_LENGTH = 256;

/** Keep uint256 identifiers exact across storage, JSON and SDK boundaries. */
export const normalizeNftTokenId = (value: unknown): string => {
  if (
    (typeof value === 'string' &&
      value.length <= MAX_NFT_TOKEN_ID_STRING_LENGTH &&
      /^(?:\d+|0x[\da-f]+)$/i.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'bigint' && value >= BigInt(0))
  ) {
    const tokenId = BigInt(value);
    if (!(tokenId >> BigInt(256))) return tokenId.toString();
  }
  throw new Error('Invalid token id');
};
