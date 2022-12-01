import { TypedData } from 'ethers-eip712';

import {
  web3Provider,
  setActiveNetwork as setProviderNetwork,
} from '@pollum-io/sysweb3-network';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import {
  blockingRestrictedMethods,
  unrestrictedMethods,
} from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import { getController } from 'utils/browser';
import { decodeTransactionData } from 'utils/ethUtil';

export const EthProvider = (host: string) => {
  const sendTransaction = async (params: ITransactionParams) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

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

    const resp = await popupPromise({
      host,
      data: { tx, decodedTx, external: true },
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

  const personalSign = async (params: string[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);
    const data = params;
    const resp = await popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'personal_sign',
    });
    return resp;
  };
  const signTypedData = (data: TypedData) =>
    popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData',
    });

  const signTypedDataV3 = (data: TypedData) =>
    popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData_v3',
    });

  const signTypedDataV4 = (data: TypedData) =>
    popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData_v4',
    });
  const getEncryptionPubKey = (address: string) => {
    const data = { address: address };
    return popupPromise({
      host,
      data,
      route: 'tx/encryptKey',
      eventName: 'eth_getEncryptionPublicKey',
    });
  };

  const decryptMessage = (data: string[]) =>
    popupPromise({
      host,
      data,
      route: 'tx/decrypt',
      eventName: 'eth_decrypt',
    });

  const send = async (args: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);

    return web3Provider.send(args[0], args);
  };

  const unrestrictedRPCMethods = async (method: string, params: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);
    if (!unrestrictedMethods.find((el) => el === method)) return false;
    const resp = await web3Provider.send(method, params);
    if (method === 'eth_getTransactionReceipt') {
      console.log('Checking tx receipt', method, params, resp);
    }
    return resp;
  };

  const checkIsBlocking = (method: string) =>
    blockingRestrictedMethods.find((el) => el === method);

  const restrictedRPCMethods = async (method: string, params: any[]) => {
    setProviderNetwork(store.getState().vault.activeNetwork);
    const { account } = getController().wallet; //TODO: when UI is added account object can be inside personal_EcRecover case since it will be only used there
    switch (method) {
      case 'eth_sendTransaction':
        return await sendTransaction(params[0]);
      case 'eth_sign':
        return await ethSign(params);
      case 'eth_signTypedData':
        return await signTypedData(params as any);
      case 'eth_signTypedData_v3':
        return await signTypedDataV3(params as any);
      case 'eth_signTypedData_v4':
        return await signTypedDataV4(params as any);
      case 'personal_sign':
        return await personalSign(params);
      case 'personal_ecRecover':
        return await web3Provider._getAddress(
          account.eth.tx.verifyPersonalMessage(params[0], params[1])
        );
      case 'eth_getEncryptionPublicKey':
        return await getEncryptionPubKey(params[0]);
      case 'eth_decrypt':
        return await decryptMessage(params);
      default:
        try {
          return await web3Provider.send(method, params);
        } catch (error) {
          const errorMsg = {
            code: -32603,
            message: 'Internal JSON-RPC error',
            data: {
              code: error?.error?.code ? error.error.code : 'No code',
              data: error?.error?.data ? error.error.data : 'No data',
              message: error?.error?.message
                ? error.error.message
                : 'Invalid Transaction',
            },
          };
          throw errorMsg;
        }
    }
  };

  return {
    send,
    sendTransaction,
    signTypedData,
    signTypedDataV3,
    signTypedDataV4,
    unrestrictedRPCMethods,
    checkIsBlocking,
    restrictedRPCMethods,
  };
};
