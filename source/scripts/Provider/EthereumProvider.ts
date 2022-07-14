import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { web3Provider } from '@pollum-io/sysweb3-network';

import store from 'state/store';
import { removeSensitiveDataFromVault } from 'utils/account';

export const EthereumProvider = () => {
  const getConnectedAccount = () => {
    const account = window.controller.dapp.getConnectedAccount();
    if (!account) throw new Error('No connected account');

    delete account.xprv;

    return account;
  };

  const getNetwork = async () => web3Provider.eth.net.getNetworkType();

  const getAccounts = async () => web3Provider.eth.getAccounts();

  const getTokens = async (address: string) =>
    Web3Accounts().getTokens(address);

  const getChainId = async () => web3Provider.eth.getChainId();

  const getAddress = async () => await web3Provider.eth.getAccounts()[0];

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
