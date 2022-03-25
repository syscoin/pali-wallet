// @ts-nocheck
import { web3Provider } from '@pollum-io/sysweb3-network';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { getController } from 'utils/browser';

export const EthereumProvider = () => {
  const getNetwork = async () => {
    const currentNetwork = await web3Provider.eth.net.getNetworkType();
    return currentNetwork;
  };

  const getAccounts = async () => {
    const accounts = await web3Provider.eth.getAccounts();
    return accounts;
  };

  const getXpub = () => {
    const controller = getController();
    const activeAccount = controller.wallet.account.getActiveAccount();
    return activeAccount?.xpub;
  };

  const getTokens = async (address: string) => {
    const userTokens = await Web3Accounts().getTokens(address);
    return userTokens;
  };

  const getChainId = async () => {
    const currentChainId = await web3Provider.eth.getChainId();
    return currentChainId;
  };

  const getAddress = async () => {
    const address = await web3Provider.eth.getAccounts();
    return address[0];
  };

  const getBalance = async (address: string) => {
    const accountBalance = await web3Provider.eth.getBalance(address);
    return accountBalance;
  };

  const handleLockAccount = async (walletAddress: string) =>
    web3Provider.eth.personal.lockAccount(walletAddress);

  const handleUnlockAccount = async (walletAddress: string) =>
    web3Provider.eth.personal.unlockAccount(walletAddress);

  return {
    getAccounts,
    getNetwork,
    getChainId,
    getXpub,
    getTokens,
    getAddress,
    getBalance,
    handleLockAccount,
    handleUnlockAccount,
  };
};
