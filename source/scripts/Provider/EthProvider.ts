import { TypedData } from 'ethers-eip712';
import { ethErrors } from 'helpers/errors';

import { validateEOAAddress } from '@pollum-io/sysweb3-utils';

import { getController } from 'scripts/Background';
import { getUnrestrictedMethods } from 'scripts/Background/controllers/message-handler/method-registry';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { decodeTransactionData } from 'utils/ethUtil';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

export const EthProvider = (host: string) => {
  const sendTransaction = async (params: ITransactionParams) => {
    const {
      ethereumTransaction: { web3Provider },
    } = getController().wallet;

    // Safety check: ensure web3Provider exists for EVM networks
    if (!web3Provider) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'EthProvider methods are not available on UTXO networks'
        )
      );
    }

    const tx = params;
    const validateTxToAddress = await validateEOAAddress(tx.to, web3Provider);
    // Get current block to check EIP1559 compatibility
    const currentBlock = await web3Provider.getBlock('latest');
    const isLegacyTx = !(await verifyNetworkEIP1559Compatibility(currentBlock));
    const decodedTx = (await decodeTransactionData(
      tx,
      validateTxToAddress
    )) as IDecodedTx;
    if (!decodedTx) throw cleanErrorStack(ethErrors.rpc.invalidRequest());

    //Open Contract Interaction component
    if (validateTxToAddress.contract || !isLegacyTx) {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: MethodRoute.SendEthTx,
        eventName: 'txSend',
      });
      return resp;
    }

    //Open Send Component
    if (validateTxToAddress.wallet || isLegacyTx || !tx.data) {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: MethodRoute.SendNTokenTx,
        eventName: 'nTokenTx',
      });

      return resp;
    }

    if (
      decodedTx.method === 'Contract Deployment' ||
      decodedTx.method === 'Burn'
    ) {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: MethodRoute.SendNTokenTx,
        eventName: 'nTokenTx',
      });

      return resp;
    }

    if (decodedTx.method === 'approve') {
      const resp = await popupPromise({
        host,
        data: { tx, decodedTx, external: true },
        route: MethodRoute.SendApprove,
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
      route: MethodRoute.EthSign,
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
      route: MethodRoute.EthSign,
      eventName: 'personal_sign',
    });
    return resp;
  };
  const signTypedData = (data: TypedData[]) => {
    if (!data.length) throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: MethodRoute.EthSign,
      eventName: 'eth_signTypedData',
    });
  };

  const signTypedDataV3 = (data: TypedData[]) => {
    if (!data.length || data.length < 2)
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: MethodRoute.EthSign,
      eventName: 'eth_signTypedData_v3',
    });
  };

  const signTypedDataV4 = (data: TypedData[]) => {
    if (!data.length || data.length < 2)
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: MethodRoute.EthSign,
      eventName: 'eth_signTypedData_v4',
    });
  };
  const getEncryptionPubKey = (address: string) => {
    if (!address) throw cleanErrorStack(ethErrors.rpc.invalidParams());
    const data = { address: address };
    return popupPromise({
      host,
      data,
      route: MethodRoute.EncryptKey,
      eventName: 'eth_getEncryptionPublicKey',
    });
  };

  const decryptMessage = (data: string[]) => {
    if (!data.length || data.length < 2 || !data[0] || !data[1])
      throw cleanErrorStack(ethErrors.rpc.invalidParams());
    return popupPromise({
      host,
      data,
      route: MethodRoute.DecryptKey,
      eventName: 'eth_decrypt',
    });
  };

  const changeUTXOEVM = async (params: any[]) => {
    // Handle network type switching for bridges
    // Extract chainId and network type from params
    const chainId = params?.[0]?.chainId || params?.[0];
    const prefix = params?.[0]?.prefix || 'sys'; // Default to switching to UTXO

    if (!chainId) {
      throw cleanErrorStack(ethErrors.rpc.invalidParams('chainId is required'));
    }

    // Get the network configuration
    const { vaultGlobal } = store.getState();
    const { networks } = vaultGlobal;
    const newChainValue =
      prefix?.toLowerCase() === 'sys' ? 'syscoin' : 'ethereum';
    const targetNetwork = networks[newChainValue]?.[chainId];

    if (!targetNetwork) {
      throw cleanErrorStack(
        ethErrors.provider.custom({
          code: 4902,
          message: `Network with chainId ${chainId} not found for ${newChainValue}`,
        })
      );
    }

    return popupPromise({
      host,
      route: MethodRoute.SwitchUtxoEvm,
      eventName: 'change_UTXOEVM',
      data: {
        newNetwork: targetNetwork,
        newChainValue: newChainValue,
      },
    });
  };

  const send = async (args: any[]) => {
    const { ethereumTransaction } = getController().wallet;

    // Safety check: ensure web3Provider exists for EVM networks
    if (!ethereumTransaction?.web3Provider) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'EthProvider methods are not available on UTXO networks'
        )
      );
    }

    return ethereumTransaction.web3Provider.send(args[0], args);
  };

  const unrestrictedRPCMethods = async (method: string, params: any[]) => {
    const unrestrictedMethods = getUnrestrictedMethods();
    if (!unrestrictedMethods.includes(method)) return false;
    const { ethereumTransaction } = getController().wallet;

    // Safety check: ensure web3Provider exists for EVM networks
    if (!ethereumTransaction?.web3Provider) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'EthProvider methods are not available on UTXO networks'
        )
      );
    }

    try {
      const resp = await ethereumTransaction.web3Provider.send(method, params);

      return resp;
    } catch (error) {
      console.error({ error });
    }
  };

  const restrictedRPCMethods = async (method: string, params: any[]) => {
    const { ethereumTransaction } = getController().wallet;

    // Safety check: ensure web3Provider exists for EVM networks
    if (!ethereumTransaction?.web3Provider) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'EthProvider methods are not available on UTXO networks'
        )
      );
    }

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
        return await ethereumTransaction.web3Provider.getAddress(
          ethereumTransaction.verifyPersonalMessage(params[0], params[1])
        );
      case 'eth_getEncryptionPublicKey':
        return await getEncryptionPubKey(params[0]);
      case 'eth_decrypt':
        return await decryptMessage(params);
      case 'eth_changeUTXOEVM':
        return await changeUTXOEVM(params);
      default:
        try {
          const requestResult = await ethereumTransaction.web3Provider.send(
            method,
            params
          );
          return requestResult;
        } catch (error) {
          console.log({ requestError: error, method, params });
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
    restrictedRPCMethods,
    changeUTXOEVM,
  };
};
