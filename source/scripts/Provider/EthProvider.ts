import { TypedData } from 'ethers-eip712';

import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { unrestrictedMethods } from 'scripts/Background/controllers/message-handler/types';
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

  const signTypedDataV4 = (data: TypedData) =>
    popupPromise({
      host,
      data,
      route: 'tx/sign',
      eventName: 'txSign',
    });

  const send = async (args: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    return web3Provider.send(args[0], args);
  };

  const unrestrictedRPCMethods = async (
    method: string,
    params: any[],
    network: any
  ) => {
    console.log('checking requested network', network);
    if (!unrestrictedMethods.find((el) => el === method)) return false;
    const resp = await web3Provider.send(method, params);
    return resp;
  };

  return {
    send,
    sendTransaction,
    signTypedDataV4,
    unrestrictedRPCMethods,
  };
};
