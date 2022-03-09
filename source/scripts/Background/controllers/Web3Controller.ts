import { IWeb3 } from '@pollum-io/sysweb3/types/IWeb3';
import { createAccount as createWeb3Account } from '@pollum-io/sysweb3/dist/packages/web3-account';
import { sendTransactions as ethereumTx } from '@pollum-io/sysweb3/dist/packages/web3-transactions';
import { getBalance as getWeb3Balance } from '@pollum-io/sysweb3/dist/packages/web3-balance';
import { importAccount as importWeb3Account } from '@pollum-io/sysweb3/dist/packages/web3-import';
import {
  getNFTImage as web3NFTImage,
  getUserNFT as web3NFTUser,
} from '@pollum-io/sysweb3/dist/packages/web3-nft';
import {
  getTokens as web3UserTokens,
  getTokenIconBySymbol as getTokenIcon,
} from '@pollum-io/sysweb3/dist/packages/web3-tokens';
import {
  changeNetwork as changeWeb3Network,
  web3Provider as provider,
} from '@pollum-io/sysweb3/dist/provider/web3Provider';

export const Web3Controller = (): IWeb3 => {
  const createAccount = () => createWeb3Account();

  const importAccount = (
    mnemonicOrPrivateKey: string,
    encryptedPwdAccount: string
  ) => importWeb3Account(mnemonicOrPrivateKey, encryptedPwdAccount);

  const sendTransactions = (
    fromPrivateKey: string,
    toAddress: string,
    value: number
  ) => ethereumTx(fromPrivateKey, toAddress, value);

  const getBalance = (walletAddress: string) => getWeb3Balance(walletAddress);

  const changeNetwork = (networkId: number) => changeWeb3Network(networkId);

  const getNFTImage = (NFTContractAddress: string, tokenId: number) =>
    web3NFTImage(NFTContractAddress, tokenId);
  const getUserNFT = (walletAddress: string) => web3NFTUser(walletAddress);
  const getTokens = (walletAddress: string) => web3UserTokens(walletAddress);
  const getTokenIconBySymbol = (symbol: string) => getTokenIcon(symbol);
  const web3Provider = provider;

  return {
    createAccount,
    importAccount,
    sendTransactions,
    getBalance,
    changeNetwork,
    getNFTImage,
    getUserNFT,
    getTokens,
    getTokenIconBySymbol,
    web3Provider,
  };
};
