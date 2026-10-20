import { BigNumber } from 'utils/ethersV6Compat';

const MAX_TOKEN_ID =
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/** Keep uint256 identifiers exact across storage, JSON and SDK boundaries. */
export const normalizeNftTokenId = (value: unknown): string => {
  if (
    !(
      (typeof value === 'string' && /^(?:\d+|0x[\da-f]+)$/i.test(value)) ||
      (typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0) ||
      (typeof value === 'bigint' && value >= BigInt(0))
    )
  )
    throw new Error('Invalid token id');
  const tokenId = BigNumber.from(value);
  if (tokenId.gt(MAX_TOKEN_ID)) throw new Error('Invalid token id');
  return tokenId.toString();
};
