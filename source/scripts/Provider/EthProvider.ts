import { TypedData } from 'ethers-eip712';

import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { unrestrictedMethods } from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import { decodeTransactionData } from 'utils/ethUtil';

export const EthProvider = (host: string) => {
  const sendTransaction = async (params: ITransactionParams) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    // const from = window.controller.dapp.getAccount(host).address;

    const tx = params;

    const decodedTx = decodeTransactionData(tx) as IDecodedTx;

    if (decodedTx.method === 'approve') {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: 'tx/send/approve',
        eventName: 'txApprove',
      });
      return resp;
    }

    console.log('decodeTx in provider', decodedTx);

    const resp = await popupPromise({
      host,
      data: { tx, decodedTx, external: true },
      route: 'tx/send/ethTx',
      eventName: 'txSend',
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
      // console.log('Sending transaction', params);
      return await sendTransaction(params[0]);
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
