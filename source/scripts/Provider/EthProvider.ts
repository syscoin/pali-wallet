import { TypedData } from 'ethers-eip712';

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

  const getTokens = async (address: string) => {
    const { activeNetwork } = store.getState().vault;

    return window.controller.wallet.account.eth.getAssetsByAddress(
      address,
      activeNetwork
    );
  };

  const getBalance = async () => getAccount().balances.ethereum;

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

  const signTypedDataV4 = (data: TypedData) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign',
      eventName: 'txSign',
    });

  const send = async (method: string, args: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    if (method === 'eth_sendTransaction') return _send(args[0]);

    return web3Provider.send(method, args);
  };

  return {
    isConnected: () => Boolean(getAccount()),
    getTokens,
    getBalance,
    getAccount,
    getState,
    send,
    signTypedDataV4,
  };
};
