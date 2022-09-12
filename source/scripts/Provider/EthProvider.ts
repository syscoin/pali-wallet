import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

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

  const getTokens = async (address: string) => {
    const { activeNetwork } = store.getState().vault;
    return window.controller.wallet.account.eth.getAssetsByAddress(
      address,
      activeNetwork
    );
  };

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

  const _signTypedDataV4 = (params: [string, any], from: string) => {
    console.log('_signTypedDataV4 data:', [params, from]);
    return popupPromise({
      host,
      data: { params, from },
      route: 'tx/sign',
      eventName: 'txSign',
    });
  };

  const send = async (method: string, args: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    if (method === 'eth_sendTransaction') return _send(args[0]);
    if (method === 'eth_signTypedData_v4')
      return _signTypedDataV4(args[0], args[1]);
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
