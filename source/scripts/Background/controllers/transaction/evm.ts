import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

import store from 'state/store';
import { setAccountTransactions } from 'state/vault';

export const EthTransactionController = () => {
  const sendAndSaveTransaction = async (tx: any) => {
    store.dispatch(
      setAccountTransactions(await Web3Accounts().tx.sendTransaction(tx))
    );
  };

  return {
    ...Web3Accounts().tx,
    sendAndSaveTransaction,
  };
};
