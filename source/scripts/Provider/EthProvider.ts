// import { ethers } from 'ethers';

import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { web3Provider } from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import store from 'state/store';
import { removeSensitiveDataFromVault } from 'utils/account';

export const EthProvider = (host: string) => {
  const getAccount = () => {
    const account = window.controller.dapp.getAccount(host);
    if (!account) throw new Error('No connected account');

    return account;
  };

  // const getNetwork = async () => web3Provider.eth.net.getNetworkType();

  // const getAccounts = async () => web3Provider.eth.getAccounts();

  const getTokens = async (address: string) =>
    Web3Accounts().getAssetsByAddress(
      address,
      store.getState().vault.activeNetwork
    );

  // const getChainId = async () => web3Provider.eth.getChainId();

  // const getAddress = async () => await web3Provider.eth.getAccounts()[0];

  const getBalance = async () => getAccount().balances.ethereum;

  // const handleLockAccount = async (walletAddress: string) =>
  //   web3Provider.eth.personal.lockAccount(walletAddress);

  // const handleUnlockAccount = async (
  //   address: string,
  //   password: string,
  //   unlockDuration: number
  // ) =>
  //   web3Provider.eth.personal.unlockAccount(address, password, unlockDuration);

  const getState = () => removeSensitiveDataFromVault(store.getState().vault);

  const _send = (data: { to: string; value: number }) => {
    const from = getAccount().address;
    const tx = {
      sender: from,
      receivingAddress: data.to,
      amount: data.value,
    };
    return popupPromise({
      host,
      data: tx,
      route: 'tx/send/confirm',
      eventName: 'txSend',
    });
  };

  const send = (method: string, args: any[]) => {
    if (method === 'eth_sendTransaction') return _send(args[0]);
    return web3Provider.send(method, args);
  };

  return {
    isConnected: () => Boolean(getAccount()),
    // getAccounts,
    // getNetwork,
    // getChainId,
    // getXpub, // TODO getXpub
    getTokens,
    // getAddress,
    getBalance,
    // handleLockAccount,
    // handleUnlockAccount,
    getAccount,
    getState,
    send,
  };
};
