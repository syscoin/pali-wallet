import type { IWalletNavigationScope } from 'utils/navigationState';

import type { ISendSignedErc20TransactionProps } from '@sidhujag/sysweb3-keyring';

export const WALLET_ERC20_REVIEW_PORT = 'pali-wallet-erc20-review';

export type WalletErc20ReviewRequest = Readonly<{
  chainId: number;
  transaction: ISendSignedErc20TransactionProps;
  walletScope: IWalletNavigationScope;
}>;

export const walletErc20ReviewError = () =>
  Object.assign(new Error('This ERC20 review is no longer current.'), {
    transactionNotBroadcast: true,
  });
