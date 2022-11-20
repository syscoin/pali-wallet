import { TypedData } from 'ethers-eip712';

import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { unrestrictedMethods } from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';

export const EthProvider = (host: string) => {
  const sendTransaction = async (params: {
    data: string;
    from: string;
    gas: string;
    to: string;
    value: number;
  }) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    // const from = window.controller.dapp.getAccount(host).address;

    const tx = params;

    const resp = await popupPromise({
      host,
      data: { tx, external: true },
      route: 'tx/send/ethTx',
      eventName: 'txSend',
    });
    return resp;
  };

  const ethSign = async (params: string[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);
    const data = params;
    const resp = await popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_sign',
    });
    return resp;
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

  const unrestrictedRPCMethods = async (method: string, params: any[]) => {
    if (!unrestrictedMethods.find((el) => el === method)) return false;
    const resp = await web3Provider.send(method, params);

    return resp;
  };

  const restrictedRPCMethods = async (method: string, params: any[]) => {
    if (method === 'eth_sendTransaction') {
      return await sendTransaction(params[0]);
    } else if (method === 'eth_sign') {
      return await ethSign(params);
    }
    return await web3Provider.send(method, params);
  };

  return {
    send,
    sendTransaction,
    signTypedDataV4,
    unrestrictedRPCMethods,
    restrictedRPCMethods,
  };
};
