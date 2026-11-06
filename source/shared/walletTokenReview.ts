import type { IWalletNavigationScope } from 'utils/navigationState';

import type {
  ISendSignedErc20TransactionProps,
  ISendSignedErc721TransactionProps,
  ISendSignedErc1155TransactionProps,
} from '@sidhujag/sysweb3-keyring';

export const WALLET_TOKEN_REVIEW_PORT = 'pali-wallet-token-review';

export type WalletTokenReviewPayload = Readonly<
  | { transaction: Readonly<ISendSignedErc20TransactionProps>; type: 'ERC20' }
  | { transaction: Readonly<ISendSignedErc721TransactionProps>; type: 'ERC721' }
  | {
      transaction: Readonly<ISendSignedErc1155TransactionProps>;
      type: 'ERC1155';
    }
>;

export type WalletTokenReviewRequest = Readonly<{
  chainId: number;
  walletScope: IWalletNavigationScope;
}> &
  WalletTokenReviewPayload;

export const walletTokenReviewError = () =>
  Object.assign(new Error('This token review is no longer current.'), {
    transactionNotBroadcast: true,
  });
