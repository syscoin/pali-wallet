import { dag } from '@stardust-collective/dag4';
import { Transaction, PendingTx } from '@stardust-collective/dag4-network';
import { hdkey } from 'ethereumjs-wallet';

import store from 'state/store';
import {
  createAccount,
  updateStatus,
  removeAccount,
  updateAccount,
  updateTransactions,
  updateLabel,
  removeKeystoreInfo,
} from 'state/wallet';
import IWalletState, {
  AccountType,
  IAccountState,
  PrivKeystore,
} from 'state/wallet/types';

import { IAccountInfo, ITransactionInfo } from '../../types';
export interface IAccountController {
  getTempTx: () => ITransactionInfo | null;
  updateTempTx: (tx: ITransactionInfo) => void;
  confirmTempTx: () => Promise<void>;
  getPrivKey: (id: string, pwd: string) => Promise<string | null>;
  getPrimaryAccount: (pwd: string) => void;
  isValidDAGAddress: (address: string) => boolean;
  subscribeAccount: (
    index: number
  ) => Promise<{ [assetId: string]: string } | null>;
  unsubscribeAccount: (index: number, pwd: string) => boolean;
  addNewAccount: (
    label: string
  ) => Promise<{ [assetId: string]: string } | null>;
  updateTxs: (limit?: number, searchAfter?: string) => Promise<void>;
  updateAccountLabel: (id: string, label: string) => void;
  importPrivKeyAccount: (
    privKey: string,
    label: string
  ) => Promise<{ [assetId: string]: string } | null>;
  removePrivKeyAccount: (id: string, password: string) => boolean;
  getRecommendFee: () => Promise<number>;
  watchMemPool: () => void;
  getLatestUpdate: () => Promise<void>;
}

const AccountController = (actions: {
  getMasterKey: () => hdkey | null;
  checkPassword: (pwd: string) => boolean;
  importPrivKey: (privKey: string) => Promise<PrivKeystore | null>;
}): IAccountController => {
  let privateKey: string;
  let tempTx: ITransactionInfo | null;
  let account: IAccountState | null;
  let intervalId: any;
  let password: string;

  const _coventPendingType = (pending: PendingTx) => {
    return {
      hash: pending.hash,
      amount: pending.amount,
      receiver: pending.receiver,
      sender: pending.sender,
      fee: -1,
      isDummy: true,
      timestamp: new Date(pending.timestamp).toISOString(),
      lastTransactionRef: {},
      snapshotHash: '',
      checkpointBlock: '',
    } as Transaction;
  };

  // Primary
  const getAccountByPrivateKey = async (
    privateKey: string
  ): Promise<IAccountInfo> => {
    dag.account.loginPrivateKey(privateKey);
    // const ethAddress = dag.keyStore.getEthAddressFromPrivateKey(privateKey);
    const balance = await dag.account.getBalance();
    const transactions = await dag.account.getTransactions(10);
    return {
      address: {
        constellation: dag.account.address,
      },
      balance,
      transactions,
    };
  };

  const getAccountByIndex = async (index: number) => {
    const masterKey: hdkey | null = actions.getMasterKey();
    if (!masterKey) return null;
    privateKey = dag.keyStore.deriveAccountFromMaster(masterKey, index);
    return await getAccountByPrivateKey(privateKey);
  };

  const getAccountByPrivKeystore = async (keystoreId: string) => {
    const { keystores }: IWalletState = store.getState().wallet;
    if (!password || !keystores[keystoreId]) return null;
    privateKey = await dag.keyStore.decryptPrivateKey(
      keystores[keystoreId] as PrivKeystore,
      password
    );
    return await getAccountByPrivateKey(privateKey);
  };

  const subscribeAccount = async (index: number, label?: string) => {
    const { accounts }: IWalletState = store.getState().wallet;
    const seedAccounts = Object.values(accounts).filter(
      (account) => account.type === AccountType.Seed
    );
    if (seedAccounts && Object.keys(seedAccounts).includes(String(index)))
      return null;
    const res: IAccountInfo | null = await getAccountByIndex(index);

    account = {
      id: String(index),
      label: label || `Account ${index + 1}`,
      address: res!.address,
      balance: res!.balance,
      transactions: res!.transactions,
      type: AccountType.Seed,
    };

    store.dispatch(createAccount(account));
    return account!.address;
  };

  const removePrivKeyAccount = (id: string, pwd: string) => {
    if (!actions.checkPassword(pwd)) return false;
    store.dispatch(removeKeystoreInfo(id));
    store.dispatch(removeAccount(id));
    store.dispatch(updateStatus());
    return true;
  };

  const addNewAccount = async (label: string) => {
    const { accounts }: IWalletState = store.getState().wallet;
    const seedAccounts = Object.values(accounts).filter(
      (account) => account.type === AccountType.Seed
    );
    let idx = -1;
    Object.keys(seedAccounts).forEach((index, i) => {
      if (index !== String(i)) {
        idx = i;
        return;
      }
    });
    if (idx === -1) {
      idx = Object.keys(seedAccounts).length;
    }
    return await subscribeAccount(idx, label);
  };

  const unsubscribeAccount = (index: number, pwd: string) => {
    if (actions.checkPassword(pwd)) {
      store.dispatch(removeAccount(String(index)));
      store.dispatch(updateStatus());
      return true;
    }
    return false;
  };

  const importPrivKeyAccount = async (privKey: string, label: string) => {
    if (!label) return null;

    const keystore = await actions.importPrivKey(privKey);
    if (!keystore) return null;

    const { accounts }: IWalletState = store.getState().wallet;
    const res = await getAccountByPrivateKey(privKey);

    // check if the same account exists
    const isExisting =
      Object.values(accounts).filter(
        (acc) => acc.address.constellation === res.address.constellation
      ).length > 0;
    if (isExisting) {
      store.dispatch(removeKeystoreInfo(keystore.id));
      return null;
    }

    privateKey = privKey;
    account = {
      id: keystore.id,
      label: label,
      address: res!.address,
      balance: res!.balance,
      transactions: res!.transactions,
      type: AccountType.PrivKey,
    };

    store.dispatch(createAccount(account));
    return account!.address;
  };

  const getPrimaryAccount = (pwd: string) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;
    if (!actions.checkPassword(pwd)) return;
    password = pwd;
    getLatestUpdate();
    if (!account && accounts && Object.keys(accounts).length) {
      account = accounts[activeAccountId];
      store.dispatch(updateStatus());
    }
  };

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;
    if (
      !accounts[activeAccountId] ||
      accounts[activeAccountId].type === undefined
    )
      return;

    const accLatestInfo =
      accounts[activeAccountId].type === AccountType.Seed
        ? await getAccountByIndex(Number(activeAccountId))
        : await getAccountByPrivKeystore(activeAccountId);

    if (!accLatestInfo) return;

    account = accounts[activeAccountId];
    // check pending txs
    const memPool = window.localStorage.getItem('dag4-network-main-mempool');
    if (memPool) {
      const pendingTxs = JSON.parse(memPool);
      console.log(pendingTxs);
      pendingTxs.forEach((pTx: PendingTx) => {
        if (
          !account ||
          (account.address.constellation !== pTx.sender &&
            account.address.constellation !== pTx.receiver) ||
          accLatestInfo?.transactions.filter(
            (tx: Transaction) => tx.hash === pTx.hash
          ).length > 0
        )
          return;
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

  const getPrivKey = async (id: string, pwd: string) => {
    const { keystores, accounts }: IWalletState = store.getState().wallet;
    if (!account || !actions.checkPassword(pwd)) return null;
    if (accounts[id].type === AccountType.Seed) {
      const masterKey: hdkey | null = actions.getMasterKey();
      if (!masterKey) return null;
      return dag.keyStore.deriveAccountFromMaster(masterKey, Number(id));
    } else {
      const privkey = await dag.keyStore.decryptPrivateKey(
        keystores[id] as PrivKeystore,
        pwd
      );
      return privkey;
    }
  };

  const updateAccountLabel = (id: string, label: string) => {
    store.dispatch(updateLabel({ id, label }));
  };

  // Tx-Related
  const updateTempTx = (tx: ITransactionInfo) => {
    if (dag.account.isActive()) {
      tempTx = { ...tx };
      tempTx.fromAddress = tempTx.fromAddress.trim();
      tempTx.toAddress = tempTx.toAddress.trim();
    }
  };

  const getTempTx = () => {
    return dag.account.isActive() ? tempTx : null;
  };

  const updateTxs = async (limit = 10, searchAfter?: string) => {
    if (!account) return;
    const newTxs = await dag.account.getTransactions(limit, searchAfter);
    store.dispatch(
      updateTransactions({
        id: account.id,
        txs: [...account.transactions, ...newTxs],
      })
    );
  };

  const watchMemPool = () => {
    if (intervalId) return;
    intervalId = setInterval(async () => {
      await getLatestUpdate();
      const {
        activeAccountId,
        accounts,
      }: IWalletState = store.getState().wallet;
      if (
        !accounts[activeAccountId] ||
        !accounts[activeAccountId].transactions ||
        !accounts[activeAccountId].transactions.filter(
          (tx: Transaction) => tx.fee === -1
        ).length
      ) {
        clearInterval(intervalId);
      }
    }, 30 * 1000);
  };

  const confirmTempTx = async () => {
    if (!dag.account.isActive) {
      throw new Error('Error: No signed account exists');
    }
    if (!account) {
      throw new Error("Error: Can't find active account info");
    }
    if (!tempTx) {
      throw new Error("Error: Can't find transaction info");
    }
    try {
      console.log('from address:', dag.account.address, tempTx.fee);
      const pendingTx = await dag.account.transferDag(
        tempTx.toAddress,
        tempTx.amount,
        tempTx.fee
      );
      dag.monitor.addToMemPoolMonitor(pendingTx);
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

  // Other
  const isValidDAGAddress = (address: string) => {
    return dag.account.validateDagAddress(address);
  };

  const getRecommendFee = async () => {
    return await dag.account.getFeeRecommendation();
  };

  return {
    getTempTx,
    updateTempTx,
    confirmTempTx,
    getPrivKey,
    importPrivKeyAccount,
    getPrimaryAccount,
    isValidDAGAddress,
    subscribeAccount,
    unsubscribeAccount,
    removePrivKeyAccount,
    addNewAccount,
    getLatestUpdate,
    watchMemPool,
    updateTxs,
    updateAccountLabel,
    getRecommendFee,
  };
};

export default AccountController;
