import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { web3Provider } from '@pollum-io/sysweb3-network';

import store from 'state/store';
import {
  getConnectedAccount,
  removeSensitiveDataFromVault,
} from 'utils/account';

export const EthereumProvider = () => {
  const getNetwork = async () => {
    const currentNetwork = await web3Provider.eth.net.getNetworkType();

    return currentNetwork;
  };

  const getAccounts = async () => {
    const accounts = await web3Provider.eth.getAccounts();

    return accounts;
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

  const getBalance = async () => getConnectedAccount().balances.ethereum;

  const handleLockAccount = async (walletAddress: string) =>
    web3Provider.eth.personal.lockAccount(walletAddress);

  const handleUnlockAccount = async (
    address: string,
    password: string,
    unlockDuration: number
  ) =>
    web3Provider.eth.personal.unlockAccount(address, password, unlockDuration);

  const getState = () => removeSensitiveDataFromVault(store.getState().vault);

  return {
    isConnected: () => Boolean(getConnectedAccount()),
    getAccounts,
    getNetwork,
    getChainId,
    // getXpub, // TODO getXpub
    getTokens,
    getAddress,
    getBalance,
    handleLockAccount,
    handleUnlockAccount,
    getConnectedAccount,
    getState,
  };
};
