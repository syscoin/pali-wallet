import { isValidSYSAddress as _isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { getController } from 'scripts/Background';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
import { isNFT as _isNFT } from 'scripts/Background/controllers/utils';
import store from 'state/store';

export const SysProvider = (host: string) => {
  //* ----- Connection & Account Methods -----
  const getAccount = () => {
    const { dapp } = getController();
    return dapp.getAccount(host);
  };

  const isConnected = () => {
    const { dapp } = getController();
    return dapp.isConnected(host);
  };

  const getNetwork = () => {
    const { dapp } = getController();
    return dapp.getNetwork();
  };

  const getPublicKey = () => {
    const { dapp } = getController();
    const account = dapp.getAccount(host);
    return account?.xpub || null;
  };

  const getChangeAddress = () => {
    const { dapp, wallet } = getController();
    const account = dapp.getAccount(host);
    if (!account) {
      throw new Error('Not connected');
    }
    return wallet.getChangeAddress(account.id);
  };

  //* ----- Transaction Methods -----
  const getTransactions = () => {
    const { dapp } = getController();
    const account = dapp.getAccount(host);
    if (!account) {
      return [];
    }

    // Get transactions from Redux store
    const { activeAccount, activeNetwork, accountTransactions } =
      store.getState().vault;
    const transactions =
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.syscoin?.[
        activeNetwork.chainId
      ] || [];

    return transactions;
  };

  const transaction = (params: any[]) => {
    // Get a specific transaction by ID
    if (!params?.[0]) {
      return null;
    }

    const txId = params[0];
    const { activeAccount, activeNetwork, accountTransactions } =
      store.getState().vault;
    const transactions =
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.syscoin?.[
        activeNetwork.chainId
      ] || [];

    return transactions.find((tx: any) => tx.txid === txId) || null;
  };

  const sendTransaction = (data: any) =>
    // This has a popup defined in the registry
    popupPromise({
      host,
      data,
      route: MethodRoute.SendNTokenTx,
      eventName: 'sys_sendTransaction',
    });
  const signMessage = (data: any) =>
    // This has a popup defined in the registry
    popupPromise({
      host,
      data,
      route: MethodRoute.EthSign,
      eventName: 'sys_signMessage',
    });
  const changeUTXOEVM = (params: any[]) => {
    // Handle network type switching for bridges
    // Extract chainId and network type from params
    const chainId = params?.[0]?.chainId || params?.[0];
    const prefix = params?.[0]?.prefix || 'eth'; // Default to switching to EVM from sys provider

    if (!chainId) {
      throw new Error('chainId is required for changeUTXOEVM');
    }

    // Get the network configuration
    const { vaultGlobal } = store.getState();
    const { networks } = vaultGlobal;
    const newChainValue =
      prefix?.toLowerCase() === 'sys' ? 'syscoin' : 'ethereum';
    const targetNetwork = networks[newChainValue]?.[chainId];

    if (!targetNetwork) {
      throw new Error(
        `Network with chainId ${chainId} not found for ${newChainValue}`
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

  //* ----- Existing Sign Methods -----
  const sign = (data) =>
    popupPromise({
      host,
      data,
      route: MethodRoute.SignPsbt,
      eventName: 'txSign',
    });

  const signAndSend = (data) =>
    popupPromise({
      host,
      data,
      route: MethodRoute.SignTx,
      eventName: 'txSignAndSend',
    });

  //* ----- Validation Methods -----
  const isNFT = (data) => _isNFT(data[0] as number);

  const isValidSYSAddress = (data) => {
    const { activeNetwork } = store.getState().vault;
    const isValid = _isValidSYSAddress(data, activeNetwork.chainId); //Validate by coinType inside sysweb3 //todo: we should adjust with the new keyring types and funtionalites
    return isValid;
  };

  return {
    // Connection & Account methods
    getAccount,
    isConnected,
    getNetwork,
    getPublicKey,
    getChangeAddress,
    // Transaction methods
    getTransactions,
    transaction,
    sendTransaction,
    signMessage,
    changeUTXOEVM,
    // Sign methods
    sign,
    signAndSend,
    // Validation methods
    isNFT,
    isValidSYSAddress,
  };
};
