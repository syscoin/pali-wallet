// validateEOAAddress removed - validation should be done through background service
import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import { getUnrestrictedMethods } from 'scripts/Background/controllers/message-handler/method-registry';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { requestCoordinator } from 'scripts/Background/controllers/message-handler/request-pipeline';
import {
  IEnhancedRequestContext,
  MethodRoute,
} from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { IDecodedTx, ITransactionParams } from 'types/transactions';
import cleanErrorStack from 'utils/cleanErrorStack';
import { normalizeDappTransaction } from 'utils/dappTransaction';
import { getAddress } from 'utils/ethersV6Compat';
import { decodeTransactionData } from 'utils/ethUtil';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';
import { verifyNetworkEIP1559Compatibility } from 'utils/network';

export const EthProvider = (
  host: string,
  context?: IEnhancedRequestContext
) => {
  const sendTransaction = async (params: ITransactionParams) => {
    const tx = normalizeDappTransaction(params);
    const { wallet } = getController();
    const {
      ethereumTransaction: { web3Provider },
    } = wallet;

    // Safety check: ensure web3Provider exists for EVM networks
    if (!web3Provider) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'EthProvider methods are not available on UTXO networks'
        )
      );
    }

    // Inject the connected account's address as 'from' if missing
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
    const { vault, vaultGlobal } = store.getState();
    const { activeNetwork, activeAccount: accountMeta, accounts } = vault;
    if (
      tx.chainId !== undefined &&
      BigInt(tx.chainId) !== BigInt(activeNetwork.chainId)
    )
      throw ethErrors.rpc.invalidParams(
        'Transaction chainId does not match the active network'
      );
    const activeAccount = accounts[accountMeta.type]?.[accountMeta.id];
    const contextChanged = () => {
      throw ethErrors.provider.unauthorized(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    if (
      !activeAccount?.address ||
      activeAccount.address.toLowerCase() !== tx.from.toLowerCase()
    )
      return contextChanged();
    // Account selection consent runs in the pipeline before this handler.
    // Keep that selected context across RPC work and the coordinator's delay.
    const approvedContext: IEvmTransactionContext = {
      account: {
        address: activeAccount.address,
        id: accountMeta.id,
        type: accountMeta.type,
      },
      chainId: activeNetwork.chainId,
      rpcUrl: activeNetwork.url,
      sessionGeneration: wallet.getWalletSessionGeneration(),
      slip44: vaultGlobal.activeSlip44,
    };
    const accountFlags = [
      Boolean(activeAccount.isLedgerWallet),
      Boolean(activeAccount.isTrezorWallet),
      Boolean(activeAccount.isSmartAccount),
    ];
    const assertCurrentContext = () => {
      const { vault: current, vaultGlobal: currentGlobal } = store.getState();
      const account =
        current.accounts[current.activeAccount.type]?.[
          current.activeAccount.id
        ];
      if (
        current.isBitcoinBased ||
        current.activeNetwork.chainId !== approvedContext.chainId ||
        current.activeNetwork.url !== approvedContext.rpcUrl ||
        currentGlobal.activeSlip44 !== approvedContext.slip44 ||
        current.activeAccount.id !== approvedContext.account.id ||
        current.activeAccount.type !== approvedContext.account.type ||
        account?.address?.toLowerCase() !==
          approvedContext.account.address.toLowerCase() ||
        Boolean(account?.isLedgerWallet) !== accountFlags[0] ||
        Boolean(account?.isTrezorWallet) !== accountFlags[1] ||
        Boolean(account?.isSmartAccount) !== accountFlags[2] ||
        wallet.getWalletSessionGeneration() !==
          approvedContext.sessionGeneration
      )
        contextChanged();
    };
    assertCurrentContext();
    if (
      tx.nonce !== undefined &&
      (activeAccount.isLedgerWallet ||
        activeAccount.isTrezorWallet ||
        activeAccount.isSmartAccount ||
        [
          KeyringAccountType.Ledger,
          KeyringAccountType.Trezor,
          KeyringAccountType.SmartAccount,
        ].includes(accountMeta.type))
    )
      throw ethErrors.provider.unsupportedMethod(
        'An explicit transaction nonce is not supported for this account'
      );
    if (
      tx.accessList?.length &&
      (activeAccount.isSmartAccount ||
        accountMeta.type === KeyringAccountType.SmartAccount)
    )
      throw ethErrors.provider.unsupportedMethod(
        'Transaction access lists are not supported for smart accounts'
      );
    if (
      (activeAccount.isSmartAccount ||
        accountMeta.type === KeyringAccountType.SmartAccount) &&
      (tx.type === '0x0' || tx.gasPrice !== undefined)
    )
      throw ethErrors.provider.unsupportedMethod(
        'Smart accounts support EIP-1559 fee overrides, not legacy transaction fees.'
      );
    // Get current block to check EIP1559 compatibility
    const currentBlock = await web3Provider.getBlock('latest');
    assertCurrentContext();
    const isLegacyTx = !(await verifyNetworkEIP1559Compatibility(currentBlock));
    assertCurrentContext();
    if (
      isLegacyTx &&
      (tx.type === '0x2' ||
        tx.accessList !== undefined ||
        tx.maxFeePerGas !== undefined ||
        tx.maxPriorityFeePerGas !== undefined)
    )
      throw ethErrors.provider.unsupportedMethod(
        'This network does not support EIP-1559 transactions'
      );
    const decodedTx = (await decodeTransactionData(
      tx as ITransactionParams,
      web3Provider,
      wallet
    )) as IDecodedTx;
    assertCurrentContext();
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
      isLegacyTx: isLegacyTx || tx.type === '0x0' || tx.gasPrice !== undefined,
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
        () => {
          assertCurrentContext();
          return popupPromise({
            signal: context?.originalRequest.signal,
            sender: context?.originalRequest.sender,
            host,
            data: {
              tx,
              decodedTx,
              txMetadata,
              approvedContext,
              external: true,
            },
            route,
            eventName,
          });
        },
        route
      );
    } else {
      return popupPromise({
        signal: context?.originalRequest.signal,
        sender: context?.originalRequest.sender,
        host,
        data: { tx, decodedTx, txMetadata, approvedContext, external: true },
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
      // Retain the legacy hash-object input without changing the caller's params.
      const input = params?.[0];
      const hash = input && typeof input === 'object' ? input.hash : input;
      if (
        !Array.isArray(params) ||
        params.length !== 1 ||
        typeof hash !== 'string' ||
        !/^0x[\da-f]{64}$/i.test(hash)
      ) {
        throw cleanErrorStack(
          ethErrors.rpc.invalidParams(
            'Invalid transaction hash. Expected one 0x-prefixed 32-byte hash.'
          )
        );
      }
      params = [hash];
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
          // Preserve RPC codes/data and ordinary transport errors alike.
          throw error;
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
