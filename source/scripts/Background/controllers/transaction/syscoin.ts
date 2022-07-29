import {
  ISyscoinTransactions,
  KeyringManager,
} from '@pollum-io/sysweb3-keyring';

import store from 'state/store';

export interface ISysTransactionController extends ISyscoinTransactions {
  clearTemporaryTransaction: (item: string) => void;
  confirmTemporaryTransaction: ({ type, callback }) => Promise<any>;
  getTemporaryTransaction: (type: string) => any;
  updateTemporaryTransaction: ({ tx, type }) => void;
}

export const SysTransactionController = (): ISysTransactionController => {
  const { txs } = KeyringManager();

  const temporaryTransaction = {
    newAsset: null,
    mintAsset: null,
    newNFT: null,
    updateAsset: null,
    transferAsset: null,
    sendAsset: null,
    signPSBT: null,
    signAndSendPSBT: null,
    mintNFT: null,
  };

  //* ----- TemporaryTransaction -----
  const getTemporaryTransaction = (type: string) => temporaryTransaction[type];

  const clearTemporaryTransaction = (item: string) => {
    temporaryTransaction[item] = null;
  };

  const updateTemporaryTransaction = ({ tx, type }) => {
    temporaryTransaction[type] = { ...tx };
  };
  //* end

  const handleTransactionExecution = async (
    item,
    executeTransaction,
    condition?: boolean
  ) => {
    const { activeAccount } = store.getState().vault;

    if (!activeAccount) {
      throw new Error("Error: Can't find active account info");
    }

    if (!item) throw new Error("Error: Can't find item info");

    return new Promise((resolve, reject) => {
      executeTransaction(item, condition)
        .then((response) => resolve(response))
        .catch((error) => reject(error));
    });
  };

  const confirmTemporaryTransaction = ({ type, callback }) =>
    new Promise((resolve, reject) => {
      try {
        const response = handleTransactionExecution(
          getTemporaryTransaction(type),
          callback
        );

        resolve(response);
      } catch (error: any) {
        reject(error);
      }
    });

  return {
    getTemporaryTransaction,
    clearTemporaryTransaction,
    updateTemporaryTransaction,
    confirmTemporaryTransaction,
    ...txs,
  };
};
