// isValidSYSAddress removed - validation should use message passing to background

import { getController } from 'scripts/Background';
import store from 'state/store';
import { getSentryNetwork } from 'utils/sentry/network';

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

    // Local acknowledgement provenance is an internal read-after-write fence,
    // not part of a dapp transaction response. In particular it can contain the
    // wallet's configured backend URL. Preserve every ordinary public field and
    // return new rows so the guard remains intact in the wallet's own store.
    return transactions.map((transaction) => {
      const { localAcknowledgedInputs: _local, ...publicTransaction } =
        transaction;
      void _local;
      return publicTransaction;
    });
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
    getSentryCapabilities: () => {
      getSentryNetwork(store.getState().vault.activeNetwork);
      return {
        version: 1,
        operations: [
          'register',
          'updateService',
          'updateRegistrar',
          'registerOperator',
          'rotateOperator',
          'revoke',
        ],
        linkNode: true,
        governanceVote: {
          scheme: 'secp256k1',
          signal: 'funding',
          maxNodes: 20,
        },
        eras: ['legacy-v3', 'pq-v4'],
        schemes: ['secp256k1', 'bls-basic', 'slh-dsa-shake-128s'],
        roles: ['owner', 'operator', 'collateral', 'voting'],
        keySelection: 'wallet-approval',
        result: 'operator-authorized-transaction',
        requiresFeeInputSignatures: true,
        feeSigning: 'same-origin-authorized-psbt-v1',
      };
    },
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
