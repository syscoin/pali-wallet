import { formatFullPrecisionBalance } from './format';

const MAX_NFT_QUANTITY =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const getNftQuantity = (nft?: {
  balance?: number;
  rawBalance?: unknown;
  tokenStandard?: string;
}) => {
  const normalized =
    typeof nft?.rawBalance === 'string'
      ? nft.rawBalance.replace(/^0+(?=\d)/, '')
      : undefined;
  const exactQuantity =
    nft?.tokenStandard === 'ERC-1155' &&
    typeof normalized === 'string' &&
    /^\d{1,78}$/.test(normalized) &&
    (normalized.length < MAX_NFT_QUANTITY.length ||
      normalized <= MAX_NFT_QUANTITY)
      ? normalized
      : undefined;
  return {
    exactQuantity,
    quantity:
      exactQuantity === undefined
        ? nft?.tokenStandard === 'ERC-1155' &&
          (!Number.isSafeInteger(nft.balance) || nft.balance < 0)
          ? '—'
          : nft?.balance
        : formatFullPrecisionBalance(exactQuantity, 0),
    isSingle:
      exactQuantity === undefined ? nft?.balance === 1 : exactQuantity === '1',
  };
};
