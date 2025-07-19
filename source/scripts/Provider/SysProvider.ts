import { isValidSYSAddress as _isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { getController } from 'scripts/Background';
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

  //* ----- Validation Methods -----
  const isNFT = (params: any[]) => _isNFT(params?.[0] as number);

  const isValidSYSAddress = (params: any[]) => {
    const { activeNetwork } = store.getState().vault;
    const isValid = _isValidSYSAddress(params?.[0], activeNetwork.chainId); //Validate by coinType inside sysweb3 //todo: we should adjust with the new keyring types and funtionalites
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
    // Validation methods
    isNFT,
    isValidSYSAddress,
  };
};
