// @ts-nocheck
import { web3Provider } from '@pollum-io/sysweb3-network';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { getController } from 'utils/browser';
import store from 'state/store';

export const EthereumProvider = () => {
  const getConnectedAccount = () => {
    const controller = getController();

    const {
      address,
      assets,
      balance,
      id,
      isTrezorWallet,
      label,
      web3Address,
      xpub,
      trezorId,
    } = controller?.wallet?.account?.getConnectedAccount();

    return {
      address,
      assets,
      balance,
      id,
      isTrezorWallet,
      label,
      web3Address,
      xpub,
      trezorId,
    };
  };

  const { balance } = getConnectedAccount();

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

  const getBalance = async () => balance;

  const handleLockAccount = async (walletAddress: string) =>
    web3Provider.eth.personal.lockAccount(walletAddress);

  const handleUnlockAccount = async (walletAddress: string) =>
    web3Provider.eth.personal.unlockAccount(walletAddress);

  const getState = () => _getOmittedSensitiveState(store.getState().wallet);

  return {
    isConnected: Boolean(
      getController()?.wallet?.account.getConnectedAccount()
    ),
    getAccounts,
    getNetwork,
    getChainId,
    getXpub,
    getTokens,
    getAddress,
    getBalance,
    handleLockAccount,
    handleUnlockAccount,
    getConnectedAccount,
    getWalletState,
  };
};
