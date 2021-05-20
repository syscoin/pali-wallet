import store from 'state/store';
import {
  createAccount,
  updateStatus,
  removeAccount,
  updateAccount,
  updateLabel,
  updateTransactions,
  updateAccountAddress
} from 'state/wallet';
import IWalletState, {
  IAccountState
} from 'state/wallet/types';
import {
  IAccountInfo,
  ITransactionInfo,
  Transaction,
  Assets,
  ISPTInfo,
  ISPTIssue,
  INFTIssue
} from '../../types';
import { sys } from 'constants/index';
import { fromZPub } from 'bip84';

export interface IAccountController {
  subscribeAccount: (isHardwareWallet: boolean, sjs?: any, label?: string) => Promise<string | null>;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  unsubscribeAccount: (index: number, pwd: string) => boolean;
  updateAccountLabel: (id: number, label: string) => void;
  addNewAccount: (label: string) => Promise<string | null>;
  watchMemPool: () => void;
  getLatestUpdate: () => void;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string) => boolean;
  getRecommendFee: () => Promise<number>;
  updateTxs: () => void;
  getTempTx: () => ITransactionInfo | null;
  getNewSPT: () => ISPTInfo | null;
  getIssueSPT: () => ISPTIssue | null;
  getIssueNFT: () => INFTIssue | null;
  updateTempTx: (tx: ITransactionInfo) => void;
  createSPT: (spt: ISPTInfo) => void;
  issueSPT: (spt: ISPTIssue) => void;
  issueNFT: (nft: INFTIssue) => void;
  confirmNewSPT: () => Promise<null | any>;
  confirmIssueSPT: () => Promise<null | any>;
  confirmIssueNFT: () => Promise<null | any>;
  confirmTempTx: () => Promise<null | any>;
  setNewAddress: (addr: string) => boolean;
  getTransactionInfoByTxId: (txid: any) => any;
  getSysExplorerSearch: () => string;
}

const AccountController = (actions: {
  checkPassword: (pwd: string) => boolean;
}): IAccountController => {
  let intervalId: any;
  let account: IAccountState;
  let tempTx: ITransactionInfo | null;
  let sysjs: any;
  let newSPT: ISPTInfo | null;
  let mintSPT: ISPTIssue | null;
  let mintNFT: INFTIssue | null;

  const getAccountInfo = async (isHardwareWallet?: boolean, xpub?: any): Promise<IAccountInfo> => {
    let res, address = null;
    if (isHardwareWallet) {
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, xpub, 'tokens=nonzero&details=txs', true);
      let account0 = new fromZPub(xpub, sysjs.HDSigner.pubTypes, sysjs.HDSigner.networks)
      let receivingIndex: number = -1
      if (res.tokens) {
        res.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/')
            if (splitPath.length >= 6) {
              const index = parseInt(splitPath[5], 10)
              if (index > receivingIndex) {
                receivingIndex = index
              }
            }
          }
        })
      }
      address = account0.getAddress(receivingIndex + 1)

    }
    else {
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'tokens=nonzero&details=txs', true, sysjs.HDSigner);

    }


    const balance = res.balance / 1e8;
    let transactions: Transaction[] = [];
    let assets: Assets[] = [];

    if (res.transactions) {
      transactions = res.transactions.map((transaction: Transaction) => {
        return <Transaction>
          {
            txid: transaction.txid,
            value: transaction.value,
            confirmations: transaction.confirmations,
            fees: transaction.fees,
            blockTime: transaction.blockTime,
            tokenType: transaction.tokenType,
          }
      }).slice(0, 10);
    }

    if (res.tokensAsset) {
      let transform = res.tokensAsset.reduce((res: any, val: any) => {
        res[val.assetGuid] = <Assets>{
          type: val.type,
          assetGuid: val.assetGuid,
          symbol: atob(val.symbol),
          balance: (res[val.assetGuid] ? res[val.assetGuid].balance : 0) + Number(val.balance),
          decimals: val.decimals,
        };

        return res;
      }, {});

      for (var key in transform) {
        assets.push(transform[key]);
      }
    }
    if (address) {
      return {
        balance,
        assets,
        transactions,
        address
      };

    }
    else {
      return {
        balance,
        assets,
        transactions,
      };
    }
  };

  const subscribeAccount = async (isHardwareWallet: boolean = false, sjs?: any, label?: string) => {
    if (isHardwareWallet) {
      const { accounts } = store.getState().wallet;
      let trezorID: number = accounts.reduce((trezorID: number, account: IAccountState) => (account.trezorId) ? trezorID = trezorID > account.trezorId ? trezorID : account.trezorId : trezorID, 0);
      console.log("The trezor id" + trezorID)
      const trezorinfo: IAccountInfo | null = await getAccountInfo(isHardwareWallet, sjs.descriptor);

      if (trezorinfo.address) {
        account = {
          id: 9999999,
          label: `Trezor ${trezorID + 1}`,
          balance: sjs.availableBalance / (10 ** 8),
          transactions: trezorinfo.transactions,
          xpub: sjs.descriptor,
          address: { 'main': trezorinfo.address },
          assets: trezorinfo.assets,
          connectedTo: [],
          isTrezorWallet: true,
          trezorId: trezorID + 1
        };
        store.dispatch(createAccount(account));
        console.log(account!.xpub)
        return account!.xpub;

      }
      else {

        console.error("The trezor info output is wrong" + JSON.stringify(trezorinfo))
        return null;
      }
    }


    if (sjs) {
      sysjs = sjs;
    }

    sysjs.HDSigner.createAccount();
    sysjs.HDSigner.accountIndex = 0;

    const res: IAccountInfo | null = await getAccountInfo();

    account = {
      id: sysjs.HDSigner.accountIndex,
      label: label || `Account ${sysjs.HDSigner.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.HDSigner.getAccountXpub(),
      masterPrv: sysjs.HDSigner.accounts[sysjs.HDSigner.accountIndex].getAccountPrivateKey(),
      address: { 'main': await sysjs.HDSigner.getNewReceivingAddress() },
      assets: res.assets,
      connectedTo: [],
      isTrezorWallet: false
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
    return await subscribeAccount(false, null, label);
  };

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;



    if (!accounts[activeAccountId]) {
      return;
    };
    account = accounts[activeAccountId];
    if (!account.isTrezorWallet) {
      sysjs.HDSigner.accountIndex = activeAccountId;
      const accLatestInfo = await getAccountInfo();

      if (!accLatestInfo) return;



      store.dispatch(
        updateAccount({
          id: activeAccountId,
          balance: accLatestInfo.balance,
          transactions: accLatestInfo.transactions,
          assets: accLatestInfo.assets
        })
      );
    }
    else {
      const accLatestInfo = await getAccountInfo(true, account.xpub);

      if (!accLatestInfo) return;
      store.dispatch(
        updateAccount({
          id: activeAccountId,
          balance: accLatestInfo.balance,
          transactions: accLatestInfo.transactions,
          assets: accLatestInfo.assets
        })
      );

    }
  };

  const getPrimaryAccount = (pwd: string, sjs: any) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;

    if (sjs) {
      sysjs = sjs;
    }

    if (!actions.checkPassword(pwd)) return;

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

  const isValidSYSAddress = (address: string) => {
    if (address) { // validate sys address
      return true;
    }
    return false;
  };

  const isNFT = (guid: number) => {
    let assetGuid = BigInt.asUintN(64, BigInt(guid))
    return (assetGuid >> BigInt(32)) > 0
  }

  const getRecommendFee = async () => {
    return await sys.utils.fetchEstimateFee(sysjs.blockbookURL, 1) / 10 ** 8;
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
  };

  const getTempTx = () => {
    return tempTx || null;
  };

  const getNewSPT = () => {
    return newSPT || null;
  };

  const getIssueSPT = () => {
    return mintSPT || null;
  };

  const getIssueNFT = () => {
    return mintNFT || null;
  };

  const updateTempTx = (tx: ITransactionInfo) => {
    tempTx = { ...tx };
    tempTx.fromAddress = tempTx.fromAddress.trim();
    tempTx.toAddress = tempTx.toAddress.trim();
  };

  const setNewAddress = (addr: string) => {
    const { activeAccountId } = store.getState().wallet;

    store.dispatch(
      updateAccountAddress({
        id: activeAccountId,
        address: { "main": addr },
      })
    );

    return true;
  }

  const createSPT = (spt: ISPTInfo) => {
    newSPT = spt;

    return true;
  }

  const issueSPT = (spt: ISPTIssue) => {
    mintSPT = spt;

    return true;
  }

  const issueNFT = (nft: INFTIssue) => {
    mintNFT = nft;

    return true;
  }

  const confirmNewSPT = async () => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!newSPT) {
      throw new Error("Error: Can't find NewSPT info");
    }

    try {
      const _assetOpts = {
        precision: newSPT.precision, symbol: newSPT.symbol, maxsupply: new sys.utils.BN(newSPT.maxsupply), description: newSPT.description
      }
      const txOpts = { rbf: newSPT.rbf }

      const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, null, newSPT.receiver, new sys.utils.BN(newSPT.fee));
      const txInfo = pendingTx.extractTransaction().getId();

      store.dispatch(
        updateTransactions({
          id: account.id,
          txs: [_coventPendingType(txInfo), ...account.transactions],
        })
      );

      tempTx = null;

      watchMemPool();

      return null;
    } catch (error) {
      throw new Error(error);
    }
  }

  const confirmIssueSPT = async () => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!mintSPT) {
      throw new Error("Error: Can't find transaction info");
    }

    try {
      //Code for minting SPT
      mintSPT = null;

      return null;
    } catch (error) {
      throw new Error(error);
    }
  }

  const confirmIssueNFT = async () => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!mintNFT) {
      throw new Error("Error: Can't find transaction info");
    }

    try {
      //Code for minting nft
      mintNFT = null;

      return null;
    } catch (error) {
      throw new Error(error);
    }
  }

  const confirmTempTx = async () => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!tempTx) {
      throw new Error("Error: Can't find transaction info");
    }

    try {
      if (tempTx.isToken && tempTx.token) {
        const txOpts = { rbf: tempTx.rbf }
        const value = isNFT(tempTx.token.assetGuid) ? new sys.utils.BN(tempTx.amount) : new sys.utils.BN(tempTx.amount * 10 ** tempTx.token.decimals);

        const assetMap = new Map([
          [tempTx.token.assetGuid, { changeAddress: null, outputs: [{ value: value, address: tempTx.toAddress }] }]
        ]);

        const pendingTx = await sysjs.assetAllocationSend(txOpts, assetMap, null, new sys.utils.BN(tempTx.fee * 1e8));
        const txInfo = pendingTx.extractTransaction().getId();

        store.dispatch(
          updateTransactions({
            id: account.id,
            txs: [_coventPendingType(txInfo), ...account.transactions],
          })
        );
      } else {
        const _outputsArr = [
          { address: tempTx.toAddress, value: new sys.utils.BN(tempTx.amount * 1e8) }
        ];
        const txOpts = { rbf: tempTx.rbf }

        const pendingTx = await sysjs.createTransaction(txOpts, null, _outputsArr, new sys.utils.BN(tempTx.fee * 1e8));
        const txInfo = pendingTx.extractTransaction().getId();

        store.dispatch(
          updateTransactions({
            id: account.id,
            txs: [_coventPendingType(txInfo), ...account.transactions],
          })
        );
      }

      tempTx = null;

      watchMemPool();

      return null;
    } catch (error) {
      throw new Error(error);
    }
  };

  const getTransactionInfoByTxId = async (txid: any) => {
    return await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);
  }

  const getSysExplorerSearch = () => {
    return sysjs.blockbookURL;
  }

  return {
    subscribeAccount,
    getPrimaryAccount,
    unsubscribeAccount,
    updateAccountLabel,
    addNewAccount,
    getLatestUpdate,
    watchMemPool,
    getTempTx,
    updateTempTx,
    confirmTempTx,
    isValidSYSAddress,
    updateTxs,
    getRecommendFee,
    setNewAddress,
    isNFT,
    createSPT,
    getNewSPT,
    confirmNewSPT,
    issueSPT,
    issueNFT,
    getIssueSPT,
    getIssueNFT,
    confirmIssueSPT,
    confirmIssueNFT,
    getTransactionInfoByTxId,
    getSysExplorerSearch
  };
};

export default AccountController;