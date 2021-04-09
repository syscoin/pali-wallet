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
  // PendingTx,
  Transaction
} from '../../types';
import { sys } from 'constants/index';
// import { type } from 'os';


export interface IAccountController {
  subscribeAccount: (sjs?: any, label?: string) => Promise<string | null>;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
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
  confirmTempTx: () => Promise<null | any>;
  setNewAddress: (addr: string) => boolean;
  // transfer: (sender: string, receiver: string, amount: number, fee: number | undefined) => any | null;
}

const AccountController = (actions: {
  checkPassword: (pwd: string) => boolean;
  importPrivKey: (privKey: string) => Keystore | null;
}): IAccountController => {
  let intervalId: any;
  let account: IAccountState;
  // let password: string;
  let tempTx: ITransactionInfo | null;
  let sysjs: any;


  const getAccountInfo = async (): Promise<IAccountInfo> => {
    let res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'tokens=used&details=txs', true, sysjs.HDSigner);
    const balance = res.balance / 1e8;
    const assets = res.tokens;
    let transactions: Transaction[] = []
    if (res.transactions)
      transactions = res.transactions.slice(0, 10);

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

  const subscribeAccount = async (sjs?: any, label?: string) => {
    console.log(sjs)
    if (sjs) sysjs = sjs;
    else {
      // console.log("Checking the init funciton", sysjs.HDSigner.accountIndex)
      // sysjs.HDSigner.accountIndex = idx
      console.log("Checking the init funciton", sysjs.HDSigner.accounts);
      sysjs.HDSigner.createAccount()
      console.log("Checking the init funciton", sysjs.HDSigner.accounts)
      console.log("INdex", sysjs.HDSigner.accountIndex)
    }
    console.log("check sysjs lib", sysjs)
    const res: IAccountInfo | null = await getAccountInfo();
    console.log('syscoin backend output', res)
    //TODO: get the 10 last transactions from the backend and pass to transaction buffer
    //TODO: balance for each SPT token
    console.log(sysjs.HDSigner)
    account = {
      id: sysjs.HDSigner.accountIndex,
      label: label || `Account ${sysjs.HDSigner.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.HDSigner.getAccountXpub(),
      masterPrv: sysjs.HDSigner.accounts[sysjs.HDSigner.accountIndex].getAccountPrivateKey(),
      address: { 'main': await sysjs.HDSigner.getNewReceivingAddress() },
      assets: res.assets,
      accountIsConnected: false,
      connectedTo: ''
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
    return await subscribeAccount(null, label);
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

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;
    console.log("active account id", sysjs.HDSigner.accountIndex)
    sysjs.HDSigner.accountIndex = activeAccountId
    console.log("accounts", accounts)
    console.log("active account id", sysjs.HDSigner)
    if (!accounts[activeAccountId]) {
      return;
    };

    const accLatestInfo = await getAccountInfo();

    if (!accLatestInfo) return;
    account = accounts[activeAccountId];

    // const memPool = ''; // get pending txs from syscoin
    // if (memPool) {
    //   const pendingTxs = JSON.parse(memPool);
    //   pendingTxs.forEach((pTx: PendingTx) => {
    //     // if (
    //     //   !account ||
    //     //   (account.address.main !== pTx.sender &&
    //     //     account.address.main !== pTx.receiver) ||
    //     //   accLatestInfo?.transactions.filter(
    //     //     (tx: Transaction) => tx.txid === pTx.hash
    //     //   ).length > 0
    //     // )
    //     //   return;
    //     accLatestInfo!.transactions.unshift(_coventPendingType(pTx));
    //   });
    // }

    store.dispatch(
      updateAccount({
        id: activeAccountId,
        balance: accLatestInfo.balance,
        transactions: accLatestInfo.transactions,
      })
    );
  };

  const getPrimaryAccount = (pwd: string, sjs: any) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;
    if (!sysjs) {
      sysjs = sjs;
    }
    if (!actions.checkPassword(pwd)) return;
    // password = pwd;

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
          (tx: Transaction) => tx.confirmations > 0
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
    return 0.000001;
  };

  const _coventPendingType = (txid: string) => {

    return {
      txid: txid,
      value: 0,
      confirmations: 0,
      fees: 0,
      blockTime: Date.now() / 1e3,
    } as Transaction;
  };

  const updateTxs = () => {
    if (!account) {
      return;
    }

    getLatestUpdate();

    // store.dispatch(
    //   updateTransactions({
    //     id: account.id,
    //     txs: [...account.transactions, ...newTxs],
    //   })
    // );
  };

  const getTempTx = () => {
    return tempTx || null;
  };

  const updateTempTx = (tx: ITransactionInfo) => {
    tempTx = { ...tx };
    tempTx.fromAddress = tempTx.fromAddress.trim();
    tempTx.toAddress = tempTx.toAddress.trim();
  };

  // const transfer = (sender: string, receiver: string, amount: number, fee: number | undefined) => {
  //   return {
  //     pendingTx: {
  //       timestamp: Date.now(),
  //       hash: 'hashString',
  //       amount,
  //       receiver,
  //       sender,
  //     },
  //     transactionInfo: {
  //       fromAddress: sender,
  //       toAddress: receiver,
  //       amount: amount,
  //       fee,
  //     }
  //   }
  // }
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
  const confirmTempTx = async () => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
      return (new Error('Error: No signed account exists'))
    }
    if (!account) {
      throw new Error("Error: Can't find active account info");
      return (new Error("Error: Can't find active account info"))
    }
    if (!tempTx) {
      throw new Error("Error: Can't find transaction info");
      return (new Error("Error: Can't find transaction info"))
    }
    console.log("sys teste send syscoinjs", sysjs)
    console.log(tempTx.amount / 1e8, tempTx.fee / 1e8, tempTx.toAddress)
    try {
      const _outputsArr = [
        { address: tempTx.toAddress, value: new sys.utils.BN(tempTx.amount * 1e8) }
      ]

      const pendingTx = await sysjs.createTransaction({ rbf: false }, null, _outputsArr, new sys.utils.BN(tempTx.fee * 1e8));
      console.log("lets see", pendingTx)
      // console.log("tempTx.amount", tempTx.amount);
      // console.log("tempTx.amount BN", new sys.utils.BN(tempTx.amount * 1e8));
      // console.log("tempTx.amount BN", new sys.utils.BN(tempTx.fee * 1e8));
      // console.log("tempTx.amount BN", (tempTx.fee * 1e8));

      // console.log("1 sys bn", new sys.utils.BN(100000000));

      // const _outputsArr = [
      //   { address: 'tsys1q2uqmjptmjf6ugt25yufq9xmawqmaws3upgl5y0', value: new sys.utils.BN(10054699544) }
      // ]
      // const pendingTx = await sysjs.createTransaction({ rbf: false }, null, _outputsArr, new sys.utils.BN(10))
      const txInfo = pendingTx.extractTransaction().getId()
      store.dispatch(
        updateTransactions({
          id: account.id,
          txs: [_coventPendingType(txInfo), ...account.transactions],
        })
      );
      tempTx = null;
      return null;

      watchMemPool();
    } catch (error) {
      console.log("erro ele", error)
      return error;
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
    // transfer
  };
};

export default AccountController;