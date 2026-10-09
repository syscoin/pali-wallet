// isValidSYSAddress removed - validation should use message passing to background

import { getController } from 'scripts/Background';
import store from 'state/store';

export const SysProvider = (host: string) => {
  //* ----- Connection & Account Methods -----
  const getAccount = () => {
    const { dapp, wallet } = getController();
    return wallet.isUnlocked() ? dapp.getAccount(host) : null;
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
    const account = getAccount();
    return account?.xpub || null;
  };

  const getChangeAddress = () => {
    const { wallet } = getController();
    const account = getAccount();
    if (!account) {
      throw new Error('Not connected');
    }
    return wallet.getChangeAddress(account.id);
  };

  const getCurrentAddressPubkey = (params: any[]) => {
    const { wallet } = getController();
    const account = getAccount();
    if (!account) {
      throw new Error('Not connected');
    }

    const isChangeAddress = params?.[0]?.isChangeAddress || false;
    return wallet.getCurrentAddressPubkey(account.id, isChangeAddress);
  };

  const getBip32Path = (params: any[]) => {
    const { wallet } = getController();
    const account = getAccount();
    if (!account) {
      throw new Error('Not connected');
    }

    const isChangeAddress = params?.[0]?.isChangeAddress || false;
    return wallet.getBip32Path(account.id, isChangeAddress);
  };

  //* ----- Transaction Methods -----
  const getTransactions = () => {
    const account = getAccount();
    if (!account) {
      return [];
    }

    // Get transactions from Redux store
    const connection = getController().dapp.get(host);
    const { activeNetwork, accountTransactions } = store.getState().vault;

    if (!connection || !activeNetwork) {
      return [];
    }

    const transactions =
      accountTransactions[connection.accountType]?.[connection.accountId]
        ?.syscoin?.[activeNetwork.chainId] || [];

    return transactions;
  };

  const transaction = (params: any[]) => {
    // Get a specific transaction by ID
    if (!params?.[0]) {
      return null;
    }

    const txId = params[0];
    return getTransactions().find((tx: any) => tx.txid === txId) || null;
  };

  //* ----- Validation Methods -----
  const isValidSYSAddress = (params: any[]) => {
    const { activeNetwork } = store.getState().vault;
    const isValid = getController().wallet.validateSysAddress(
      params?.[0],
      activeNetwork.chainId
    );
    return isValid;
  };

  return {
    // Connection & Account methods
    getAccount,
    isConnected,
    getNetwork,
    getPublicKey,
    getChangeAddress,
    getCurrentAddressPubkey,
    getBip32Path,
    // Transaction methods
    getTransactions,
    transaction,
    // Validation methods
    isValidSYSAddress,
  };
};
