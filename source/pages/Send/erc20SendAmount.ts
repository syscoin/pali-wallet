import { parseTokenAmount } from '../../shared/erc20';

// The extension's number field accepts .5 and leading zeros. Normalize that
// spelling before using the same exact conversion as the mobile wallet.
export const parseWalletErc20SendAmount = (value: string, decimals: number) =>
  parseTokenAmount(
    value.replace(/^\.(?=\d)/, '0.').replace(/^0+(?=\d)/, ''),
    decimals
  );
