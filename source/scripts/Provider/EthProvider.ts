// validateEOAAddress removed - validation should be done through background service
import { getAddress } from '@ethersproject/address';
import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import { getUnrestrictedMethods } from 'scripts/Background/controllers/message-handler/method-registry';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { requestCoordinator } from 'scripts/Background/controllers/message-handler/request-pipeline';
import {
  IEnhancedRequestContext,
  MethodRoute,
} from 'scripts/Background/controllers/message-handler/types';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { decodeTransactionData } from 'utils/ethUtil';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

export const EthProvider = (
  host: string,
  context?: IEnhancedRequestContext
) => {
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

    // Inject the connected account's address as 'from' if missing
    const tx = { ...params };
    if (!tx.from) {
      const { dapp } = getController();
      const connectedAccount = dapp.getAccount(host);
      if (connectedAccount) {
        tx.from = connectedAccount.address;
      } else {
        throw cleanErrorStack(
          ethErrors.provider.unauthorized(
            'No account connected. Please connect your wallet first.'
          )
        );
      }
    }
    // Get current block to check EIP1559 compatibility
    const currentBlock = await web3Provider.getBlock('latest');
    const isLegacyTx = !(await verifyNetworkEIP1559Compatibility(currentBlock));
    const decodedTx = (await decodeTransactionData(
      tx,
      web3Provider,
      getController().wallet
    )) as IDecodedTx;
    if (!decodedTx) throw cleanErrorStack(ethErrors.rpc.invalidRequest());

    // Always use SendEthTx route, pass transaction type as metadata
    const route = MethodRoute.SendEthTx;
    const eventName = 'txSend';

    // Determine transaction characteristics
    const isContractInteraction = decodedTx.method === 'Contract Interaction';
    const isApproval =
      decodedTx.method === 'approve' ||
      decodedTx.method === 'increaseAllowance' ||
      decodedTx.method === 'decreaseAllowance' ||
      decodedTx.method === 'setApprovalForAll';
    const isDeployment = decodedTx.method === 'Contract Deployment';
    const isBurn = decodedTx.method === 'Burn';

    // Pass transaction metadata for the component to handle appropriately
    const txMetadata = {
      isLegacyTx,
      isContractInteraction,
      isApproval,
      isDeployment,
      isBurn,
      decodedMethod: decodedTx.method,
      approvalType: (decodedTx as any).approvalType,
      tokenStandard: (decodedTx as any).tokenStandard,
    };

    // Use coordinator if context is provided, otherwise direct popup
    if (context) {
      return requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            data: { tx, decodedTx, txMetadata, external: true },
            route,
            eventName,
          }),
        route
      );
    } else {
      return popupPromise({
        host,
        data: { tx, decodedTx, txMetadata, external: true },
        route,
        eventName,
      });
    }
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

    // Handle personal_ecRecover here since it's an unrestricted method
    if (method === 'personal_ecRecover') {
      // verifyPersonalMessage returns the address, but we need to checksum it
      const recoveredAddress = ethereumTransaction.verifyPersonalMessage(
        params[0],
        params[1]
      );
      // Convert to checksummed address format using ethers
      return getAddress(recoveredAddress);
    }

    // Handle subscription methods (not supported)
    if (method === 'eth_subscribe' || method === 'eth_unsubscribe') {
      throw cleanErrorStack(
        ethErrors.provider.unsupportedMethod(
          `${method} is not supported. Pali does not support WebSocket subscriptions.`
        )
      );
    }

    // Validate eth_getTransactionReceipt params
    if (method === 'eth_getTransactionReceipt') {
      // Handle case where an object with hash property is passed instead of string
      if (
        params &&
        params.length > 0 &&
        typeof params[0] === 'object' &&
        params[0].hash
      ) {
        params[0] = params[0].hash;
      }

      // Validate the transaction hash format
      if (params && params.length > 0) {
        const hash = params[0];
        if (
          typeof hash !== 'string' ||
          !hash.startsWith('0x') ||
          hash.length !== 66
        ) {
          throw cleanErrorStack(
            ethErrors.rpc.invalidParams(
              `Invalid transaction hash format. Expected 0x-prefixed 66-character string, got: ${
                typeof hash === 'object' ? JSON.stringify(hash) : hash
              }`
            )
          );
        }
      }
    }

    // Defaults
    try {
      const resp = await ethereumTransaction.web3Provider.send(method, params);

      return resp;
    } catch (error) {
      console.error({ error });
      throw error;
    }
  };

  const restrictedRPCMethods = async (method: string, params: any[]) => {
    // Get ethereumTransaction once at the beginning
    const { ethereumTransaction } = getController().wallet;
    switch (method) {
      case 'eth_sendTransaction':
        return await sendTransaction(params[0]);
      // Popup-based methods are now handled by the method handler with coordinator
      default:
        try {
          // Safety check: ensure web3Provider exists for EVM networks
          if (!ethereumTransaction?.web3Provider) {
            throw cleanErrorStack(
              ethErrors.provider.unauthorized(
                'EthProvider methods are not available on UTXO networks'
              )
            );
          }
          const requestResult = await ethereumTransaction.web3Provider.send(
            method,
            params
          );
          return requestResult;
        } catch (error) {
          console.error({ requestError: error, method, params });
          throw cleanErrorStack(
            ethErrors.rpc.internal(error.error.data || error.error.message)
          );
        }
    }
  };

  return {
    send,
    sendTransaction,
    unrestrictedRPCMethods,
    restrictedRPCMethods,
  };
};
