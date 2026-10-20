/** Keep uint256 identifiers exact across storage, JSON and SDK boundaries. */
export const normalizeNftTokenId = (value: unknown): string => {
  if (
    (typeof value === 'string' && /^(?:\d+|0x[\da-f]+)$/i.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'bigint' && value >= BigInt(0))
  ) {
    const tokenId = BigInt(value);
    if (!(tokenId >> BigInt(256))) return tokenId.toString();
  }
  throw new Error('Invalid token id');
};
