import { Web3Accounts } from '@syspollum/sysweb3-keyring';
import {
  getNftImage as web3NFTImage,
  getTokenIconBySymbol as getTokenIcon,
} from '@syspollum/sysweb3-utils';
import { web3Provider as provider } from '@syspollum/sysweb3-network';

export const EthereumProvider = () => {
  const createAccount = () => Web3Accounts().createAccount();

  const importAccount = (
    mnemonicOrPrivateKey: string,
    encryptedPwdAccount: string
  ) => Web3Accounts().importAccount(mnemonicOrPrivateKey, encryptedPwdAccount);

  const sendTransactions = (
    fromPrivateKey: string,
    toAddress: string,
    value: number
  ) => Web3Accounts().sendTransaction(fromPrivateKey, toAddress, value);

  const getBalance = (walletAddress: string) =>
    Web3Accounts().getBalance(walletAddress);

  const changeNetwork = (networkId: number) =>
    Web3Accounts().setActiveNetwork(networkId);

  const getNFTImage = (NFTContractAddress: string, tokenId: number) =>
    web3NFTImage(NFTContractAddress, tokenId);
  const getUserNFT = (walletAddress: string) =>
    Web3Accounts().getNftsByAddress(walletAddress);
  const getTokens = (walletAddress: string) =>
    Web3Accounts().getTokens(walletAddress);
  const getTokenIconBySymbol = (symbol: string) => getTokenIcon(symbol);
  const web3Provider = provider;

  return {
    createAccount,
    importAccount,
    sendTransactions,
    changeNetwork,
    getNFTImage,
    getUserNFT,
    getTokenIconBySymbol,
    web3Provider,
    getBalance,
    getTokens,
  };
};
