import store from 'state/store';
import { bech32 } from 'bech32';
import {
  createAccount,
  updateStatus,
  removeAccount,
  updateAccount,
  updateLabel,
  updateTransactions,
  updateAccountAddress,
  updateAccountXpub
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
  INFTIssue,
  MintedToken,
} from '../../types';
import { sys } from 'constants/index';

export interface IAccountController {
  subscribeAccount: (sjs?: any, label?: string) => Promise<string | null>;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  unsubscribeAccount: (index: number, pwd: string) => boolean;
  updateAccountLabel: (id: number, label: string) => void;
  addNewAccount: (label: string) => Promise<string | null>;
  watchMemPool: () => void;
  getLatestUpdate: () => void;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string, network: string) => boolean | undefined;
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
  confirmNewSPT: () => void;
  confirmIssueSPT: () => void;
  confirmIssueNFT: () => void;
  confirmTempTx: () => void;
  setNewAddress: (addr: string) => boolean;
  setNewXpub: (id: number, xpub: string) => boolean;
  getUserMintedTokens: () => any;
  createCollection: (collectionName: string, description: string, sysAddress: string, symbol: any, property1?: string, property2?: string, property3?: string, attribute1?: string, attribute2?: string, attribute3?: string) => void;
  getCollection: () => any;
  getTransactionInfoByTxId: (txid: any) => any;
  getSysExplorerSearch: () => string;
  setDataFromPageToCreateNewSPT: (data: any) => void;
  getDataFromPageToCreateNewSPT: () => any | null;
  setDataFromWalletToCreateSPT: (data: any) => void;
  getDataFromWalletToCreateSPT: () => any | null;
  setDataFromPageToMintSPT: (data: any) => void;
  getDataFromPageToMintSPT: () => any | null;
  setDataFromWalletToMintSPT: (data: any) => void;
  getDataFromWalletToMintSPT: () => any | null;
  setDataFromPageToMintNFT: (data: any) => void;
  getDataFromPageToMintNFT: () => any | null;
  setDataFromWalletToMintNFT: (data: any) => void;
  getDataFromWalletToMintNFT: () => any | null;
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
  let collection: any;
  let dataFromPageToCreateSPT: any;
  let dataFromWalletToCreateSPT: any;
  let dataFromPageToMintSPT: any;
  let dataFromWalletToMintSPT: any;
  let dataFromPageToMintNFT: any;
  let dataFromWalletToMintNFT: any;
  let resAddress: any;
  let encode: any;

  const getAccountInfo = async (): Promise<IAccountInfo> => {
    let res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'tokens=nonzero&details=txs', true, sysjs.HDSigner);
    console.log('res account info and sysjs', res, sysjs)

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

    return {
      balance,
      assets,
      transactions,
    };
  };

  const subscribeAccount = async (sjs?: any, label?: string) => {
    if (sjs) {
      sysjs = sjs;
    }

    sysjs.HDSigner.createAccount();

    console.log('subscribe account', sysjs.HDSigner)

    const res: IAccountInfo | null = await getAccountInfo();

    account = {
      id: sysjs.HDSigner.accountIndex,
      label: label || `Account ${sysjs.HDSigner.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.HDSigner.getAccountXpub(),
      address: { 'main': await sysjs.HDSigner.getNewReceivingAddress() },
      assets: res.assets,
      connectedTo: []
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

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

    sysjs.HDSigner.accountIndex = activeAccountId;

    console.log('sysjs get latest update', sysjs)

    if (!accounts[activeAccountId]) {
      return;
    };

    const accLatestInfo = await getAccountInfo();

    if (!accLatestInfo) return;

    account = accounts[activeAccountId];

    store.dispatch(
      updateAccount({
        id: activeAccountId,
        balance: accLatestInfo.balance,
        transactions: accLatestInfo.transactions,
        assets: accLatestInfo.assets
      })
    );
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

  const isValidSYSAddress = (address: string, network: string) => {
    if (address) {
      try {
        resAddress = bech32.decode(address);

        if (network === "main" && resAddress.prefix === "sys") {
          encode = bech32.encode(resAddress.prefix, resAddress.words);
  
          if (address === account.address.main) {
            return false;
          }

          return encode === address.toLowerCase();
        }
    
        if (network === "testnet" && resAddress.prefix === "tsys") {
          encode = bech32.encode(resAddress.prefix, resAddress.words);

          if (address === account.address.main) {
            return false;
          }
    
          return encode === address.toLowerCase();
        }
      } catch (error) {
        return false;
      }

      return false;
    }

    return false;
  };

  const isNFT = (guid: number) => {
    let assetGuid = BigInt.asUintN(64, BigInt(guid));

    return (assetGuid >> BigInt(32)) > 0;
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

  const setNewXpub = (id: number, xpub: string) => {
    store.dispatch(
      updateAccountXpub({
        id: id,
        xpub: xpub,
      })
    );

    return true;
  }

  const setDataFromPageToCreateNewSPT = (data: any) => {
    dataFromPageToCreateSPT = data;
  } 
  const getDataFromPageToCreateNewSPT = () => {
    return dataFromPageToCreateSPT || null;
  }

  const setDataFromWalletToCreateSPT = (data: any) => {
    dataFromWalletToCreateSPT = data;
  }

  const getDataFromWalletToCreateSPT = () => {
    return dataFromWalletToCreateSPT || null;
  }

  const setDataFromPageToMintSPT = (data: any) => {
    dataFromPageToMintSPT = data;
  }
  
  const getDataFromPageToMintSPT = () => {
    return dataFromPageToMintSPT || null;
  }

  const setDataFromWalletToMintSPT = (data: any) => {
    console.log('data mint spt', data)
    dataFromWalletToMintSPT = data;
  }

  const getDataFromWalletToMintSPT = () => {
    return dataFromWalletToMintSPT || null;
  }

  const setDataFromPageToMintNFT = (data: any) => {
    dataFromPageToMintNFT = data;
  } 
  const getDataFromPageToMintNFT = () => {
    return dataFromPageToMintNFT || null;
  }

  const setDataFromWalletToMintNFT = (data: any) => {
    console.log('set data nft', data)
    dataFromWalletToMintNFT = data;
  }

  const getDataFromWalletToMintNFT = () => {
    console.log('data mint nft', dataFromWalletToMintNFT)
    return dataFromWalletToMintNFT || null;
  }

  const createSPT = (spt: ISPTInfo) => {
    newSPT = spt;
    console.log("checkout the spt", spt)

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

  const confirmSPTCreation = async (item: any) => {
    const newMaxSupply = item.maxsupply * 1e8;

    const _assetOpts = {
      precision: item.precision, symbol: item.symbol, maxsupply: new sys.utils.BN(newMaxSupply), description: item.description
    }

    const txOpts = { rbf: item.rbf }
      
    const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, null, null, new sys.utils.BN(item.fee * 1e8));
    
    const txInfo = pendingTx.extractTransaction().getId();

    store.dispatch(
      updateTransactions({
        id: account.id,
        txs: [_coventPendingType(txInfo), ...account.transactions],
      })
    );

    item = null;

    watchMemPool();
  }

  const handleTransactions = (item: any, executeTransaction: any) => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error("Error: Can't find active account info");
    }

    if (!item) {
      throw new Error("Error: Can't find NewSPT info");
    }

    try {
      executeTransaction(item);

      return null;
    } catch (error) {
      throw new Error(error);
    }
  }

  const confirmNewSPT = () => {
    handleTransactions(newSPT, confirmSPTCreation);
  }

  const confirmMintSPT = async (item: any) => {
    const feeRate = new sys.utils.BN(item.fee * 1e8);
    const txOpts = { rbf: item.rbf };
    const assetGuid = item.assetGuid;
    const assetChangeAddress = null;

    console.log('mint spt', item)

    const assetMap = new Map([
      [assetGuid, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(item.amount * 1e8), address: item.receiver }] }]
    ]);

    const sysChangeAddress = null;

    const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

    console.log('minting spt pendingTx', pendingTx);

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?')
    }

    const txInfo = pendingTx.extractTransaction().getId();
    console.log('tx info mint spt', txInfo)

    store.dispatch(
      updateTransactions({
        id: account.id,
        txs: [_coventPendingType(txInfo), ...account.transactions],
      })
    );

    watchMemPool();
  }

  const confirmIssueSPT = () => {
    handleTransactions(mintSPT, confirmMintSPT);
  }

  const confirmMintNFT = async (item: any) => {
    const feeRate = new sys.utils.BN(item.fee * 1e8);
    const txOpts = { rbf: item?.rbf };
    const assetGuid = item?.assetGuid;
    const NFTID = sys.utils.createAssetID('1', assetGuid);
    const assetChangeAddress = null;

    const assetMap = new Map([
      [assetGuid, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(1000), address: item?.receiver }] }],
      [NFTID, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(1), address: item?.receiver }] }]
    ]);

    console.log('mint nft', item)
    console.log('minting nft asset map', assetMap);

    const sysChangeAddress = null;

    const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

    console.log('minting nft pendingTx', pendingTx);

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?')
    }

    const txInfo = pendingTx.extractTransaction().getId();
    console.log('tx info mint nft', txInfo)

    store.dispatch(
      updateTransactions({
        id: account.id,
        txs: [_coventPendingType(txInfo), ...account.transactions],
      })
    );

    mintNFT = null;  
  }

  const confirmIssueNFT = () => {
    handleTransactions(mintNFT, confirmMintNFT);
  }

  const confirmTransactionTx = async (item: any) => {
    if (item.isToken && item.token) {
      const txOpts = { rbf: item.rbf }
      const value = isNFT(item.token.assetGuid) ? new sys.utils.BN(item.amount) : new sys.utils.BN(item.amount * 10 ** item.token.decimals);

      const assetMap = new Map([
        [item.token.assetGuid, { changeAddress: null, outputs: [{ value: value, address: item.toAddress }] }]
      ]);

      const pendingTx = await sysjs.assetAllocationSend(txOpts, assetMap, null, new sys.utils.BN(item.fee * 1e8));
      const txInfo = pendingTx.extractTransaction().getId();

      store.dispatch(
        updateTransactions({
          id: account.id,
          txs: [_coventPendingType(txInfo), ...account.transactions],
        })
      );
    } else {
      const _outputsArr = [
        { address: item.toAddress, value: new sys.utils.BN(item.amount * 1e8) }
      ];
      const txOpts = { rbf: item.rbf }

      const pendingTx = await sysjs.createTransaction(txOpts, null, _outputsArr, new sys.utils.BN(item.fee * 1e8));
      const txInfo = pendingTx.extractTransaction().getId();

      store.dispatch(
        updateTransactions({
          id: account.id,
          txs: [_coventPendingType(txInfo), ...account.transactions],
        })
      );
    }

    item = null;

    watchMemPool();
  }

  const confirmTempTx = () => {
    handleTransactions(tempTx, confirmTransactionTx);
  };

  const getUserMintedTokens = async () => {
    let mintedTokens: MintedToken[] = [];

    const res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'details=txs&assetMask=non-token-transfers', true, sysjs.HDSigner);

    if (res.transactions) {
      res.transactions.map((transaction: any) => {
        if (transaction.tokenType === 'SPTAssetActivate' && transaction.tokenTransfers) {
          for (let item of transaction.tokenTransfers) {
            if (mintedTokens.indexOf({ assetGuid: item.token, symbol: atob(item.symbol) }) === -1) {
              mintedTokens.push({
                assetGuid: item.token,
                symbol: atob(item.symbol)
              });
            }

            return;
          }
        }

        return;
      });

      return mintedTokens;
    }

    return;
  }

  const createCollection = (collectionName: string, description: string, sysAddress: string, symbol: any, property1?: string, property2?: string, property3?: string, attribute1?: string, attribute2?: string, attribute3?: string) => {
    console.log('[account controller]: collection created')

    collection = {
      collectionName,
      description,
      sysAddress,
      symbol,
      property1,
      property2,
      property3,
      attribute1,
      attribute2,
      attribute3
    }

    console.log(collection)
  }

  const getCollection = () => {
    return collection;
  }

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
    setNewXpub,
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
    getUserMintedTokens,
    createCollection,
    getCollection,
    getTransactionInfoByTxId,
    getSysExplorerSearch,
    setDataFromPageToCreateNewSPT,
    getDataFromPageToCreateNewSPT,
    setDataFromWalletToCreateSPT,
    getDataFromWalletToCreateSPT,
    setDataFromPageToMintSPT,
    getDataFromPageToMintSPT,
    setDataFromWalletToMintSPT,
    getDataFromWalletToMintSPT,
    setDataFromPageToMintNFT,
    getDataFromPageToMintNFT,
    setDataFromWalletToMintNFT,
    getDataFromWalletToMintNFT
  };
};

export default AccountController;