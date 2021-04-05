import store from 'state/store';
import {
  createAccount,
  updateStatus,
  removeAccount,
  updateAccount,
  updateLabel,
  // removeKeystoreInfo,
  updateTransactions,
  updateAccountAddress
} from 'state/wallet';
import IWalletState, {
  // AccountType,
  IAccountState,
  Keystore
} from 'state/wallet/types';
import {
  IAccountInfo,
  ITransactionInfo,
  PendingTx,
  Transaction
} from '../../types';
import { sys } from 'constants/index';


export interface IAccountController {
  subscribeAccount: (sjs: any, label?: string) => Promise<string | null>;
  getPrimaryAccount: (pwd: string) => void;
  unsubscribeAccount: (index: number, pwd: string) => boolean;
  updateAccountLabel: (id: number, label: string) => void;
  addNewAccount: (label: string) => Promise<string | null>;
  // removePrivKeyAccount: (id: number, password: string) => boolean;
  watchMemPool: () => void;
  getLatestUpdate: () => void;
  // importPrivKeyAccount: (privKey: string, label: string) => { [assetId: string]: string } | null;
  isValidSYSAddress: (address: string) => boolean;
  getRecommendFee: () => number;
  // getPrivKey: (id: number, pwd: string) => string | null;
  updateTxs: () => void;
  getTempTx: () => ITransactionInfo | null;
  updateTempTx: (tx: ITransactionInfo) => void;
  confirmTempTx: () => void;
  setNewAddress: (addr: string) => boolean;
  transfer: (sender: string, receiver: string, amount: number, fee: number | undefined) => any | null;
}

const AccountController = (actions: {
  checkPassword: (pwd: string) => boolean;
  importPrivKey: (privKey: string) => Keystore | null;
}): IAccountController => {
  let intervalId: any;
  let account: IAccountState;
  let password: string;
  let tempTx: ITransactionInfo | null;


  const getAccountInfo = async (sjs: any): Promise<IAccountInfo> => {

    let res = await sys.utils.fetchBackendAccount(sjs.blockbookURL, sjs.HDSigner.getAccountXpub(), 'tokens=used&details=txs', true, sjs.HDSigner);
    const balance = res.balance;
    const assets = res.tokens;
    const transactions: Transaction[] = res.transactions.slice(0, 10);
    console.log(transactions)
    return {
      balance,
      assets,
      transactions,
    };
  };

  // const getAccountByPrivKeystore = (keystoreId: number) => {
  //   const { keystores }: IWalletState = store.getState().wallet;

  //   if (!password || !keystores[keystoreId]) {
  //     return null;
  //   }

  //   return getAccountByPrivateKey();
  // };

  const subscribeAccount = async (sjs: any, label?: string) => {
    // const { accounts }: IWalletState = store.getState().wallet;
    // TODO: addapt this function to create new accounts as well check --> addNewAccount method in the class
    // const account0 = sjs.HDsigner.accounts[0]
    // if (!account0 && sjs.HDsigner.accountIndex != 0) throw new Error("Error: account not created properly on wallet creation HDsigner object")

    const res: IAccountInfo | null = await getAccountInfo(sjs);
    console.log('syscoin backend output', res)
    //TODO: get the 10 last transactions from the backend and pass to transaction buffer
    //TODO: balance for each SPT token

    account = {
      id: sjs.HDSigner.accountIndex,
      label: label || `Account ${sjs.HDSigner.accountIndex + 1}`,
      balance: res.balance / 10 ** 8,
      transactions: res.transactions,
      xpub: sjs.HDSigner.getAccountXpub(),
      address: { 'main': sjs.HDSigner.getNewReceivingAddress() },
      assets: res.assets
    };
    store.dispatch(createAccount(account));

    return account!.xpub;
  };

  const unsubscribeAccount = (index: number, pwd: string) => {
    if (actions.checkPassword(pwd)) {
      store.dispatch(removeAccount(index));
      store.dispatch(updateStatus());

      return true;
    }

    return false;
  };

  const updateAccountLabel = (id: number, label: string) => {
    store.dispatch(updateLabel({ id, label }));
  };

  const addNewAccount = async (label: string) => {
    const { accounts }: IWalletState = store.getState().wallet;

    // const seedAccounts = accounts.filter(
    //   (account) => account.type === AccountType.Seed
    // );

    let idx = 1;
    if (idx === 1) {
      idx = accounts.length;
    }

    return await subscribeAccount(idx + 1, label);
  };

  // const removePrivKeyAccount = (id: number, pwd: string) => {
  //   if (!actions.checkPassword(pwd)) {
  //     return false;
  //   }

  //   store.dispatch(removeKeystoreInfo(id));
  //   store.dispatch(removeAccount(id));
  //   store.dispatch(updateStatus());

  //   return true;
  // };

  const getLatestUpdate = () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

    if (!accounts[activeAccountId]) {
      return;
    };

    const accLatestInfo = getAccountInfo(sjs);

    if (!accLatestInfo) return;
    account = accounts[activeAccountId];

    const memPool = ''; // get pending txs from syscoin
    if (memPool) {
      const pendingTxs = JSON.parse(memPool);
      pendingTxs.forEach((pTx: PendingTx) => {
        // if (
        //   !account ||
        //   (account.address.main !== pTx.sender &&
        //     account.address.main !== pTx.receiver) ||
        //   accLatestInfo?.transactions.filter(
        //     (tx: Transaction) => tx.txid === pTx.hash
        //   ).length > 0
        // )
        //   return;
        accLatestInfo!.transactions.unshift(_coventPendingType(pTx));
      });
    }

    store.dispatch(
      updateAccount({
        id: activeAccountId,
        balance: accLatestInfo.balance,
        transactions: accLatestInfo.transactions,
      })
    );
  };

  const getPrimaryAccount = (pwd: string) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;

    if (!actions.checkPassword(pwd)) return;
    password = pwd;

    getLatestUpdate();

    if (!account && accounts) {
      account = accounts[activeAccountId];
      store.dispatch(updateStatus());
    }
  };

  const watchMemPool = () => {
    if (intervalId) {
      return;
    }

    intervalId = setInterval(() => {
      getLatestUpdate();

      const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

      if (
        !accounts[activeAccountId] ||
        !accounts[activeAccountId].transactions ||
        !accounts[activeAccountId].transactions.filter(
          (tx: Transaction) => tx.fees === -1
        ).length
      ) {
        clearInterval(intervalId);
      }
    }, 30 * 1000);
  };

  // const importPrivKeyAccount = (privKey: string, label: string) => {
  //   const keystore = label && actions.importPrivKey(privKey);

  //   if (!keystore) return null;

  //   const res = getAccountByPrivateKey();

  //   account = {
  //     id: 10,
  //     label: label,
  //     address: res!.address,
  //     balance: res!.balance,
  //     transactions: res!.transactions,
  //     type: privKey === 'private-key-account-priv'
  //       ? AccountType.PrivKey
  //       : AccountType.Seed,
  //     xpub: "myxpubhot",
  //     assets: {
  //       'lalala': {
  //         name: 'BagiImoveis',
  //         balance: 9999999
  //       }
  //     },

  //   };

  //   store.dispatch(createAccount(account));
  //   return account!.address;
  // };

  // const getPrivKey = (id: number, pwd: string) => {
  //   const { accounts }: IWalletState = store.getState().wallet;

  //   if (!account || !actions.checkPassword(pwd)) return null;

  //   if (accounts[id].type === AccountType.Seed) {
  //     return 'private-key-account-seed'; // generate private key using password and phrase
  //   }

  //   return 'private-key-account-priv'; // generate private key using password and phrase
  // };

  const isValidSYSAddress = (address: string) => {
    if (address) { // validate sys address
      return true;
    }
    return false;
  };

  const getRecommendFee = () => {
    return 0.028;
  };

  const _coventPendingType = (pending: PendingTx) => {
    return {
      txid: pending.txid,
      value: pending.value,
      confirmations: pending.confirmations,
      fees: pending.fees,
      blockTime: pending.blockTime,
    } as Transaction;
  };

  const updateTxs = () => {
    if (!account) {
      return;
    }

    const newTxs: Transaction[] = []; // get transactions request (syscoin)

    store.dispatch(
      updateTransactions({
        id: account.id,
        txs: [...account.transactions, ...newTxs],
      })
    );
  };

  const getTempTx = () => {
    return tempTx || null;
  };

  const updateTempTx = (tx: ITransactionInfo) => {
    tempTx = { ...tx };
    tempTx.fromAddress = tempTx.fromAddress.trim();
    tempTx.toAddress = tempTx.toAddress.trim();
  };

  const transfer = (sender: string, receiver: string, amount: number, fee: number | undefined) => {
    return {
      pendingTx: {
        timestamp: Date.now(),
        hash: 'hashString',
        amount,
        receiver,
        sender,
      },
      transactionInfo: {
        fromAddress: sender,
        toAddress: receiver,
        amount: amount,
        fee,
      }
    }
  }
  const setNewAddress = (addr: string) => {
    const { accounts, activeAccountId } = store.getState().wallet;
    console.log("all addresses: ", accounts[activeAccountId].address)
    console.log("last one: ", accounts[activeAccountId].address.main)
    store.dispatch(
      updateAccountAddress({
        id: activeAccountId,
        address: { "main": addr },
      })
    );
    console.log("updated one: ", accounts[activeAccountId].address.main)

    return true;



  }
  const confirmTempTx = () => {
    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!tempTx) {
      throw new Error("Error: Can't find transaction info");
    }

    try {
      const { pendingTx, transactionInfo } = transfer(
        tempTx.fromAddress,
        tempTx.toAddress,
        tempTx.amount,
        tempTx.fee
      );

      console.log('pending transaction', pendingTx)
      console.log('transaction info', transactionInfo)

      store.dispatch(
        updateTransactions({
          id: account.id,
          txs: [_coventPendingType(pendingTx), ...account.transactions],
        })
      );

      tempTx = null;
      watchMemPool();
    } catch (error) {
      throw new Error(error);
    }
  };

  return {
    subscribeAccount,
    getPrimaryAccount,
    unsubscribeAccount,
    updateAccountLabel,
    addNewAccount,
    // removePrivKeyAccount,
    getLatestUpdate,
    watchMemPool,
    // importPrivKeyAccount,
    getTempTx,
    updateTempTx,
    confirmTempTx,
    // getPrivKey,
    isValidSYSAddress,
    updateTxs,
    getRecommendFee,
    setNewAddress,
    transfer
  };
};

export default AccountController;