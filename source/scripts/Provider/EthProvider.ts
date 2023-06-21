import { TypedData } from 'ethers-eip712';
import { ethErrors } from 'helpers/errors';

import { validateEOAAddress } from '@pollum-io/sysweb3-utils';

import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import {
  blockingRestrictedMethods,
  unrestrictedMethods,
} from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import { getController } from 'utils/browser';
import cleanErrorStack from 'utils/cleanErrorStack';
import { decodeTransactionData } from 'utils/ethUtil';

export const EthProvider = (host: string) => {
  const sendTransaction = async (params: ITransactionParams) => {
    const tx = params;
    const {
      ethereumTransaction: { web3Provider },
    } = getController().wallet;
    const validateTxToAddress = await validateEOAAddress(tx.to, web3Provider);

    const decodedTx = decodeTransactionData(
      tx,
      validateTxToAddress
    ) as IDecodedTx;

    if (!decodedTx) throw cleanErrorStack(ethErrors.rpc.invalidRequest());

    //Open Send Component
    if (validateTxToAddress.wallet) {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: 'tx/send/nTokenTx',
        eventName: 'nTokenTx',
      });

      return resp;
    }
    //Open Contract Interaction component
    if (validateTxToAddress.contract) {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: 'tx/send/ethTx',
        eventName: 'txSend',
      });
      return resp;
    }

    if (decodedTx.method === 'Contract Deployment') {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: 'tx/send/nTokenTx',
        eventName: 'nTokenTx',
      });

      return resp;
    }

    if (decodedTx.method === 'approve') {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: 'tx/send/approve',
        eventName: 'txApprove',
      });
      return resp;
    }
  };

  const ethSign = async (params: string[]) => {
    const data = params;
    if (!data.length || data.length < 2 || !data[0] || !data[1])
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    const resp = await popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_sign',
    });
    return resp;
  };

  const personalSign = async (params: string[]) => {
    const data = params;
    if (!data.length || data.length < 2 || !data[0] || !data[1])
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    const resp = await popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'personal_sign',
    });
    return resp;
  };
  const signTypedData = (data: TypedData[]) => {
    if (!data.length) throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData',
    });
  };

  const signTypedDataV3 = (data: TypedData[]) => {
    if (!data.length || data.length < 2)
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData_v3',
    });
  };

  const signTypedDataV4 = (data: TypedData[]) => {
    if (!data.length || data.length < 2)
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: 'tx/ethSign',
      eventName: 'eth_signTypedData_v4',
    });
  };
  const getEncryptionPubKey = (address: string) => {
    if (!address) throw cleanErrorStack(ethErrors.rpc.invalidParams());
    const data = { address: address };
    return popupPromise({
      host,
      data,
      route: 'tx/encryptKey',
      eventName: 'eth_getEncryptionPublicKey',
    });
  };

  const decryptMessage = (data: string[]) => {
    if (!data.length || data.length < 2 || !data[0] || !data[1])
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: 'tx/decrypt',
      eventName: 'eth_decrypt',
    });
  };

  const send = async (args: any[]) => {
    const { ethereumTransaction } = getController().wallet;

    return ethereumTransaction.web3Provider.send(args[0], args);
  };

  const unrestrictedRPCMethods = async (method: string, params: any[]) => {
    if (!unrestrictedMethods.find((el) => el === method)) return false;
    const { ethereumTransaction } = getController().wallet;
    const resp = await ethereumTransaction.web3Provider.send(method, params);
    return resp;
  };

  const checkIsBlocking = (method: string) =>
    blockingRestrictedMethods.find((el) => el === method);

  const restrictedRPCMethods = async (method: string, params: any[]) => {
    const { ethereumTransaction } = getController().wallet;
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
        return await ethereumTransaction.web3Provider._getAddress(
          ethereumTransaction.verifyPersonalMessage(params[0], params[1])
        );
      case 'eth_getEncryptionPublicKey':
        return await getEncryptionPubKey(params[0]);
      case 'eth_decrypt':
        return await decryptMessage(params);
      default:
        try {
          return await ethereumTransaction.web3Provider.send(method, params);
        } catch (error) {
          throw cleanErrorStack(
            ethErrors.rpc.internal(error.error.data || error.error.message)
          );
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
