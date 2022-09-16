import { TypedData } from 'ethers-eip712';

import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import store from 'state/store';

export const EthProvider = (host: string) => {
  const sendTransaction = (data: { to: string; value: number }) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    const from = window.controller.dapp.getAccount(host).address;

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

  const signTypedDataV4 = (data: TypedData) => {
    console.log({ data });

    return popupPromise({
      host,
      data,
      route: 'tx/sign',
      eventName: 'txSign',
    });
  };

  const send = async (args: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    return web3Provider.send(args[0], args);
  };

  return {
    send,
    sendTransaction,
    signTypedDataV4,
  };
};
