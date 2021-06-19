import store from 'state/store';
import { bech32 } from 'bech32';
import TrezorConnect from 'trezor-connect';
import axios from 'axios';
import https from 'https';
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
  ISPTPageInfo,
  ISPTWalletInfo,
  INFTPageInfo,
  INFTWalletInfo,
  ISPTIssuePage,
  ISPTIssueWallet,
  UpdateToken,
  UpdateTokenPageInfo,
  UpdateTokenWalletInfo
} from '../../types';
import { sys } from 'constants/index';
import { fromZPub } from 'bip84';
const bjs = require('bitcoinjs-lib');
const bitcoinops = require('bitcoin-ops');
const syscointx = require('syscointx-js');

export interface IAccountController {
  subscribeAccount: (isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
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
  getNewUpdateAsset: () => any | null;
  getNewOwnership: () => any | null;
  updateTempTx: (tx: ITransactionInfo) => void;
  createSPT: (spt: ISPTInfo) => void;
  issueSPT: (spt: ISPTIssue) => void;
  issueNFT: (nft: INFTIssue) => void;
  confirmNewSPT: () => Promise<any>;
  confirmIssueSPT: () => Promise<any>;
  confirmIssueNFT: () => Promise<any>;
  confirmTempTx: () => Promise<any>;
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
  setDataFromPageToUpdateAsset: (data: any) => void;
  getDataFromPageToUpdateAsset: () => any;
  setDataFromWalletToUpdateAsset: (data: any) => void;
  getDataFromWalletToUpdateAsset: () => any;
  setDataFromPageToTransferOwnership: (data: any) => void;
  getDataFromPageToTransferOwnership: () => any;
  setDataFromWalletToTransferOwnership: (data: any) => void;
  getDataFromWalletToTransferOwnership: () => any;
  confirmUpdateAssetTransaction: () => any;
  confirmTransferOwnership: () => any;
  setUpdateAsset: (asset: any) => any;
  setNewOwnership: (data: any) => any;
  getHoldingsData: () => any;
  getDataAsset: (assetGuid: any) => any;
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
  let updateAssetItem: UpdateToken | null;
  let transferOwnershipData: any;
  let mintNFT: INFTIssue | null;
  let collection: any;
  let dataFromPageToCreateSPT: ISPTPageInfo;
  let dataFromWalletToCreateSPT: ISPTWalletInfo;
  let dataFromPageToMintSPT: ISPTIssuePage;
  let dataFromWalletToMintSPT: ISPTIssueWallet;
  let dataFromPageToMintNFT: INFTPageInfo;
  let dataFromWalletToMintNFT: INFTWalletInfo;
  let dataFromWalletToUpdateAsset: UpdateTokenWalletInfo;
  let dataFromPageToUpdateAsset: UpdateTokenPageInfo;
  let resAddress: any;
  let encode: any;

  const needleOptions = {
    rejectUnauthorized: false
  };

  const agent = new https.Agent({
    rejectUnauthorized: false,
  });

  const updateTransactionData = (item: string, txinfo: any) => {
    const connectedAccountId = store.getState().wallet.accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === new URL(store.getState().wallet.currentSenderURL).host;
      });
    });

    store.dispatch(
      updateTransactions({
        id: store.getState().wallet[item] ? connectedAccountId : account.id,
        txs: [_coventPendingType(txinfo), ...account.transactions],
      })
    );
  }

  const getAccountInfo = async (isHardwareWallet?: boolean, xpub?: any): Promise<IAccountInfo> => {
    let res: any = null;
    let address: any = null;

    if (isHardwareWallet) {
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, xpub, 'tokens=nonzero&details=txs', true);

      const account0: any = new fromZPub(xpub, sysjs.HDSigner.pubTypes, sysjs.HDSigner.networks);
      let receivingIndex: number = -1

      if (res.tokens) {
        res.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/');

            if (splitPath.length >= 6) {
              const change = parseInt(splitPath[4], 10);
              const index = parseInt(splitPath[5], 10);

              if (change === 1) {
                return;
              }

              if (index > receivingIndex) {
                receivingIndex = index;

                return;
              }
            }
          }
        });
      }

      address = account0.getAddress(receivingIndex + 1);
    } else {
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

      for (let key in transform) {
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

    return {
      balance,
      assets,
      transactions,
    };
  };

  const subscribeAccount = async (isHardwareWallet: boolean = false, sjs?: any, label?: string, walletCreation?: boolean) => {
    if (isHardwareWallet) {
      const { accounts } = store.getState().wallet;
      let trezorID: number = accounts.reduce((trezorID: number, account: IAccountState) => (account.trezorId) ? trezorID = trezorID > account.trezorId ? trezorID : account.trezorId : trezorID, 0);

      const trezorinfo: IAccountInfo | null = await getAccountInfo(isHardwareWallet, sjs.descriptor);

      if (trezorinfo.address) {
        account = {
          id: 9999 + trezorID,
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

        return account!.xpub;
      }

      return null;
    }

    if (sjs) {
      sysjs = sjs;
    }

    if (!walletCreation) {
      sysjs.HDSigner.createAccount();
    }

    const res: IAccountInfo | null = await getAccountInfo();

    account = {
      id: sysjs.HDSigner.accountIndex,
      label: label || `Account ${sysjs.HDSigner.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.HDSigner.getAccountXpub(),
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

  const updateAccountLabel = (id: number, label: string, isHardwareWallet?: boolean) => {
    if (isHardwareWallet) {
      return;
    }

    store.dispatch(updateLabel({ id, label }));
  };

  const addNewAccount = async (label: string) => {
    return await subscribeAccount(false, null, label);
  };

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

    if (!accounts.find(element => element.id === activeAccountId)) {
      return;
    }

    account = accounts.find(element => element.id === activeAccountId)!;

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

      return;
    }

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
  };

  const getPrimaryAccount = (pwd: string, sjs: any) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;

    if (sjs) {
      sysjs = sjs;
    }

    if (!actions.checkPassword(pwd)) return;

    getLatestUpdate();

    if (!account && accounts) {
      account = accounts.find(element => element.id === activeAccountId) || accounts[activeAccountId];
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
        !accounts.find(element => element.id === activeAccountId) ||
        !accounts.find(element => element.id === activeAccountId)?.transactions ||
        !accounts.find(element => element.id === activeAccountId)!.transactions.filter(
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

        if (network === 'main' && resAddress.prefix === 'sys') {
          encode = bech32.encode(resAddress.prefix, resAddress.words);

          return encode === address.toLowerCase();
        }

        if (network === 'testnet' && resAddress.prefix === 'tsys') {
          encode = bech32.encode(resAddress.prefix, resAddress.words);

          return encode === address.toLowerCase();
        }
      } catch (error) {
        return false;
      }
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

  const getNewUpdateAsset = () => {
    return updateAssetItem || null;
  }

  const getNewOwnership = () => {
    return transferOwnershipData || null;
  }

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
        address: { main: addr },
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

  const setDataFromPageToCreateNewSPT = (data: ISPTPageInfo) => {
    console.log('data from page to create spt', data)
    dataFromPageToCreateSPT = data;
  }

  const getDataFromPageToCreateNewSPT = () => {
    return dataFromPageToCreateSPT || null;
  }

  const setDataFromWalletToCreateSPT = (data: ISPTWalletInfo) => {
    dataFromWalletToCreateSPT = data;
  }

  const getDataFromWalletToCreateSPT = () => {
    return dataFromWalletToCreateSPT || null;
  }

  const setDataFromPageToMintSPT = (data: ISPTIssuePage) => {
    dataFromPageToMintSPT = data;
  }

  const getDataFromPageToMintSPT = () => {
    return dataFromPageToMintSPT || null;
  }

  const setDataFromWalletToMintSPT = (data: ISPTIssueWallet) => {
    dataFromWalletToMintSPT = data;
  }

  const getDataFromWalletToMintSPT = () => {
    return dataFromWalletToMintSPT || null;
  }

  const setDataFromPageToMintNFT = (data: INFTPageInfo) => {
    dataFromPageToMintNFT = data;
  }
  const getDataFromPageToMintNFT = () => {
    return dataFromPageToMintNFT || null;
  }

  const setDataFromWalletToMintNFT = (data: INFTWalletInfo) => {
    dataFromWalletToMintNFT = data;
  }

  const getDataFromWalletToMintNFT = () => {
    return dataFromWalletToMintNFT || null;
  }

  const setDataFromPageToUpdateAsset = (data: UpdateTokenPageInfo) => {
    dataFromPageToUpdateAsset = data;
  }

  const getDataFromPageToUpdateAsset = () => {
    return dataFromPageToUpdateAsset || null;
  }

  const setDataFromWalletToUpdateAsset = (data: UpdateTokenWalletInfo) => {
    dataFromWalletToUpdateAsset = data;
  }

  const getDataFromWalletToUpdateAsset = () => {
    return dataFromWalletToUpdateAsset || null;
  }

  const setDataFromPageToTransferOwnership = (data: any) => {
    dataFromPageToCreateSPT = data;
  }
  const getDataFromPageToTransferOwnership = () => {
    return dataFromPageToCreateSPT || null;
  }

  const setDataFromWalletToTransferOwnership = (data: any) => {
    dataFromWalletToCreateSPT = data;
  }

  const getDataFromWalletToTransferOwnership = () => {
    return dataFromWalletToCreateSPT || null;
  }

  const createSPT = (spt: ISPTInfo) => {
    newSPT = spt;
    console.log('new spt', spt)

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
  const setUpdateAsset = (asset: UpdateToken) => {
    updateAssetItem = asset;

    return true;
  }

  const setNewOwnership = (asset: any) => {
    transferOwnershipData = asset;

    return true;
  }

  const confirmSPTCreation = async (item: any) => {
    const {
      capabilityflags,
      notarydetails,
      auxfeedetails,
      precision,
      symbol,
      description,
      rbf,
      maxsupply,
      fee,
      notaryAddress,
      payoutAddress,
    } = item;

    const newMaxSupply = maxsupply * 1e8;

    let _assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(newMaxSupply),
      description,
      updatecapabilityflags: capabilityflags || 127,
      notarydetails,
      auxfeedetails,
      notarykeyid: Buffer.from('', 'hex')
    };

    if (notaryAddress) {
      const vNotaryPayment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: notaryAddress,
        network: sysjs.HDSigner.network
      });

      _assetOpts = {
        ..._assetOpts,
        notarydetails: {
          ...notarydetails,
          endpoint: Buffer.from(syscointx.utils.encodeToBase64(notarydetails.endpoint))
        },
        notarykeyid: Buffer.from(vNotaryPayment.hash.toString('hex'), 'hex')
      }
    }

    if (notarydetails) {
      _assetOpts = {
        ..._assetOpts,
        notarydetails
      }
    }

    if (payoutAddress) {
      const payment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: payoutAddress,
        network: sysjs.HDSigner.network
      });

      const auxFeeKeyID = Buffer.from(payment.hash.toString('hex'), 'hex');

      _assetOpts = {
        ..._assetOpts,
        auxfeedetails: {
          ..._assetOpts.auxfeedetails,
          auxfeekeyid: auxFeeKeyID
        }
      }
    }

    if (auxfeedetails) {
      _assetOpts = {
        ..._assetOpts,
        auxfeedetails
      }
    }

    console.log('new spt asset opts', item, _assetOpts)

    const txOpts = { rbf };

    if (account.isTrezorWallet) {
      throw new Error("Trezor don't support burning of coins");
    }

    const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, null, null, new sys.utils.BN(fee * 1e8));

    const txInfo = pendingTx.extractTransaction().getId();

    updateTransactionData('creatingAsset', txInfo);

    item = null;

    watchMemPool();
  }

  const handleTransactions = async (item: any, executeTransaction: any) => {
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
      await executeTransaction(item);

      return null;
    } catch (error) {
      console.log('transaction error', error);

      return error;
    }
  }

  const confirmNewSPT = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(newSPT, confirmSPTCreation));

      newSPT = null;
    })
  }

  const confirmMintSPT = async (item: any) => {
    const feeRate = new sys.utils.BN(item.fee * 1e8);
    const txOpts = { rbf: item.rbf };
    const assetGuid = item.assetGuid;
    const assetChangeAddress = null;
    let txInfo;

    console.log('mint spt item', mintSPT)

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(item.amount * 1e8),
          address: assetChangeAddress
        }]
      }]
    ]);

    let sysChangeAddress = null;

    if (account.isTrezorWallet) {
      sysChangeAddress = await getNewChangeAddress();
      // @ts-ignore: Unreachable code error
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress
      console.log("Is trezor wallet")
      console.log("SPT mint trans")

      const psbt = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate, account.xpub);
      // const psbt = await syscoinjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate) 

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      console.log("PSBT")
      console.log(psbt.res)
      console.log("PSBT response in and outs")
      console.log(psbt.res.inputs)
      console.log(psbt.res.outputs)
      console.log(psbt.res.outputs)
      //TREZOR PART GOES UNDER NOW 
      //PSBT TO --TREZOR FORMAT

      let trezortx: any = {};
      trezortx.coin = "sys";
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      // const memo = await sys.utils.getMemoFromOpReturn(psbt.res.outputs)
      // console.log('the output memo ' + (memo))
      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        let _input: any = {};

        _input.address_n = convertToBip32Path(input.path);
        _input.prev_index = input.vout;
        _input.prev_hash = input.txId;

        if (input.sequence) _input.sequence = input.sequence;

        _input.amount = input.value.toString();
        _input.script_type = 'SPENDWITNESS';
        trezortx.inputs.push(_input);
      }

      for (let i = 0; i < psbt.res.outputs.length; i++) {
        const output = psbt.res.outputs[i];
        let _output: any = {};

        _output.amount = output.value.toString();

        if (output.script) {
          _output.script_type = "PAYTOOPRETURN";

          const chunks = bjs.script.decompile(output.script);

          if (chunks[0] === bitcoinops.OP_RETURN) {
            _output.op_return_data = chunks[1].toString('hex');
          }
        }

        _output.script_type = "PAYTOWITNESS";
        _output.address = output.address;

        trezortx.outputs.push(_output);
      }

      const resp = await TrezorConnect.signTransaction(trezortx);

      if (resp.success == true) {
        txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, resp.payload.serializedTx);
      } else {
        console.log(resp.payload.error)
      }

      return;
    } else {
      const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

      console.log('minting spt pendingTx', pendingTx);

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?')
      }

      txInfo = pendingTx.extractTransaction().getId();
      console.log('tx info mint spt', txInfo)
    }
    updateTransactionData('issuingSPT', txInfo);

    watchMemPool();
  }

  const confirmIssueSPT = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(mintSPT, confirmMintSPT));

      mintSPT = null;
    });
  }

  const getAssetSharesData = (precision: number) => {
    let shares: string;
    let coin: number;

    switch (precision) {
      case 0:
        shares = "1";
        coin = 1;
        break;
      case 1:
        shares = "10";
        coin = 10;
        break;
      case 2:
        shares = "100";
        coin = 100;
        break;
      case 3:
        shares = "1,000";
        coin = 1000;
        break;
      case 4:
        shares = "10,000";
        coin = 10000;
        break;
      case 5:
        shares = "100,000";
        coin = 100000;
        break;
      case 6:
        shares = "1,000,000";
        coin = 1000000;
        break;
      case 7:
        shares = "10,000,000";
        coin = 10000000;
        break;
      case 8:
        shares = "100,000,000";
        coin = 100000000;
        break;
      default:
        throw new Error("ERROR: Must specify precision between 0 and 8.");
    }

    return {
      kShares: shares,
      kCoin: coin
    };
  }

  const createParentAsset = async (precision: number, symbol: string, description: string, fee: number, rbf: boolean, sysReceivingAddress: string) => {
    const xpub: any = await sysjs.HDSigner.getAccountXpub();
    console.log("Root xpub: " + xpub);

    const sharesData = await getAssetSharesData(precision);

    console.log("Asset shares Data: " + sharesData)

    const txOpts: any = { rbf };

    const feeRate = new sys.utils.BN(fee * 1e8)

    const assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(1 * 1e8),
      description,
      updatecapabilityflags: 0
    };

    const sysChangeAddress = null;

    console.log('asset opts parent child', assetOpts, fee, feeRate)

    const psbt = await sysjs.assetNew(assetOpts, txOpts, null, null, feeRate);

    if (!psbt) {
      console.log('Could not create transaction, not enough funds?');

      return;
    }

    const assets = syscointx.getAssetsFromTx(psbt.extractTransaction());

    const endResult = { asset_guid: assets.keys().next().value };

    console.log('end result', endResult);

    return endResult;
  }

  const issueBlankChildNFTs = async (parentAssetGuid: string, qty: number, startNFTID: number, receivingAddress: string, feeRate: number, rbf: boolean) => {
    const xpub = await sysjs.HDSigner.getAccountXpub();
    console.log("Root xpub: " + xpub);

    if (qty > 50) {
      throw new Error('ERROR: We are limiting the max quantity to 50 blank NFTs per execution. Let\'s be good stewards of the blockchain and not add much bloat.');
    }

    if ((startNFTID + qty) > 4294967295) {
      throw new Error('ERROR: NFTID may not exceed value 4294967295. Your arguments increment beyond this value.');
    }

    const newParentAssetGuid = parentAssetGuid.toString();

    const txOpts = {
      rbf,
      assetWhiteList: new Map([[parentAssetGuid, {}]])
    };

    console.log('issue blank params', parentAssetGuid, qty, startNFTID, receivingAddress, feeRate, rbf)

    const assetChangeAddress = null;
    const sysChangeAddress = null;

    let assetArray: any[] = [];

    let backendIsSynced = await axios.get(`${sysjs.blockbookURL}/api/v2`, { httpsAgent: agent });

    console.log('request backend is synced', backendIsSynced)

    if (backendIsSynced.data.blockbook.inSync == true && backendIsSynced.data.blockbook.syncMode == true) {
      for (var i = startNFTID; i <= startNFTID + qty; i++) {
        let parentAsset = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${newParentAssetGuid}`, { httpsAgent: agent });
        console.log(parentAsset.data)

        const sharesData = await getAssetSharesData(parentAsset.data.asset.decimals);

        console.log('shares data', sharesData)

        const childAssetGuid = sys.utils.createAssetID(i, parentAssetGuid);

        const NFTAssetIdAlreadyExists = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${childAssetGuid}`, { httpsAgent: agent });

        console.log(`making sure nft ${childAssetGuid} does not exist on-chain`);

        if (NFTAssetIdAlreadyExists.data.error === 'Asset not found') {
          assetArray.push(
            [Number(childAssetGuid), {
              changeAddress: assetChangeAddress,
              outputs: [{
                value: new sys.utils.BN('20000'),
                address: receivingAddress
              }]
            }]
          );

          return;
        }

        console.log(`nftid ${i} already exists on-chain for parent asset ${parentAssetGuid}`)
      }

      if (assetArray.length > 0) {
        console.log(`committing ${assetArray.length} to the blockchain`);

        const assetMap = new Map(assetArray);

        const psbt = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

        if (!psbt) {
          console.log('Could not create transaction, not enough funds?');
        }

        const onChainChildAssetGuids = syscointx.getAllocationsFromTx(psbt.extractTransaction());

        return onChainChildAssetGuids;
      }

      console.log('Nothing to commit to the blockchain!');
    }

    console.log('backend is not synced. give it time to sync, then try again');
  }

  const sendChildNFTtoCreator = async (nftGuid: string, receivingAddress: string, amount: number, feeRate: number, rbf: boolean) => {
    const xpub = await sysjs.HDSigner.getAccountXpub();
    console.log("Root xpub: " + xpub);

    const NFTguid = nftGuid.toString();
    const asset = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${NFTguid}`, { httpsAgent: agent });

    console.log('request asset', asset)
    const sharesData = await getAssetSharesData(asset.data.asset.decimals);
    const satoshiAmount = (amount * sharesData.kCoin).toString();

    const txOpts = {
      rbf,
      assetWhiteList: new Map([[NFTguid, {}]])
    };

    const assetChangeAddress = null;
    const sysChangeAddress = null;

    const assetMap = new Map([
      [NFTguid, {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(satoshiAmount),
          address: receivingAddress
        }]
      }]
    ]);

    const psbt = await sysjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate);

    if (!psbt) {
      console.log('Could not create transaction, not enough funds?')
    }

    for (let output in psbt.txOutputs) {
      console.log("The psbt txOutput: " + (psbt.txOutputs[output]))
    }
  }

  const confirmMintNFT = async (item: any) => {
    const {
      fee,
      rbf,
      precision,
      symbol,
      description,
      issuer,
      totalShares,
      notary,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);

    const newParentAsset = await createParentAsset(1, symbol, description, fee, rbf, issuer);

    const assetId = sys.utils.getBaseAssetID(newParentAsset?.asset_guid);
    const nftIdParentAsset = sys.utils.createAssetID(assetId, newParentAsset?.asset_guid);

    console.log(nftIdParentAsset)

    // 4294967295 nft id max
    // 9172645498812352635 nft id now

    await issueBlankChildNFTs(newParentAsset?.asset_guid, 1, 10, issuer, feeRate, rbf);

    // await sendChildNFTtoCreator(nftGuid, receivingAddress, amount, feeRate, rbf);

    console.log('parent asset created', newParentAsset?.asset_guid);


    // const createNewSPT: Promise<any> = new Promise((resolve) => {
    //   resolve(handleTransactions({}, confirmSPTCreation));

    //   newSPT = null;
    // });


    // const txOpts = { rbf };

    // const assetGuid = 'newassetguid';
    // const NFTID = sys.utils.createAssetID('1', assetGuid);
    // const assetChangeAddress = null;

    // let txInfo;

    // const assetMap = new Map([
    //   [assetGuid, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(1000), address: assetChangeAddress }] }],
    //   [NFTID, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(1), address: assetChangeAddress }] }]
    // ]);

    // console.log('mint nft', item)

    // let sysChangeAddress = null;
    // if (account.isTrezorWallet) {
    //   throw new Error('trezor does not support nft creation')
    // }

    // const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

    // if (!pendingTx) {
    //   console.log('Could not create transaction, not enough funds?')
    // }

    // txInfo = pendingTx.extractTransaction().getId();

    // updateTransactionData('issuingNFT', txInfo);
  }

  const confirmIssueNFT = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(mintNFT, confirmMintNFT));

      mintNFT = null;
    });
  }

  const convertToBip32Path = (address: string) => {
    let address_array: String[] = address.replace(/'/g, '').split("/")
    address_array.shift()
    let address_n: Number[] = []
    for (let index in address_array) {
      if (Number(index) <= 2 && Number(index) >= 0) {
        address_n[Number(index)] = Number(address_array[index]) | 0x80000000
      }
      else {
        address_n[Number(index)] = Number(address_array[index])
      }
    }
    console.log("Address_n")
    console.log(address_n)
    return address_n
  }

  const confirmTransactionTx = async (item: any) => {
    if (item.isToken && item.token) {
      console.log('item token', item.token)
      const txOpts = { rbf: item.rbf }
      const value = isNFT(item.token.assetGuid) ? new sys.utils.BN(item.amount) : new sys.utils.BN(item.amount * 10 ** item.token.decimals);
      let txInfo;
      const assetMap = new Map([
        [item.token.assetGuid, { changeAddress: null, outputs: [{ value: value, address: item.toAddress }] }]
      ]);

      if (account.isTrezorWallet) {
        const changeAddress = await getNewChangeAddress();
        // @ts-ignore: Unreachable code error
        assetMap.get(item.token.assetGuid)!.changeAddress = changeAddress
        const psbt = await sysjs.assetAllocationSend(txOpts, assetMap, changeAddress,
          new sys.utils.BN(item.fee * 1e8), account.xpub)
        // const psbt = await syscoinjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate) 
        if (!psbt) {
          console.log('Could not create transaction, not enough funds?')
        }
        console.log("PSBT response in & outs")
        console.log(psbt.res.inputs)
        console.log(psbt.res.outputs)
        //TREZOR PART GOES UNDER NOW 
        //PSBT TO --TREZOR FORMAT

        let trezortx: any = {};
        trezortx.coin = "sys"
        trezortx.version = psbt.res.txVersion
        trezortx.inputs = []
        trezortx.outputs = []

        // const memo = await sys.utils.getMemoFromOpReturn(psbt.res.outputs)
        // console.log('the output memo ' + (memo))
        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i]
          let _input: any = {}

          _input.address_n = convertToBip32Path(input.path)
          _input.prev_index = input.vout
          _input.prev_hash = input.txId
          if (input.sequence) _input.sequence = input.sequence
          _input.amount = input.value.toString()
          _input.script_type = 'SPENDWITNESS'
          trezortx.inputs.push(_input)
        }

        for (let i = 0; i < psbt.res.outputs.length; i++) {
          const output = psbt.res.outputs[i]
          let _output: any = {}

          _output.amount = output.value.toString()
          if (output.script) {
            _output.script_type = "PAYTOOPRETURN"
            const chunks = bjs.script.decompile(output.script)
            if (chunks[0] === bitcoinops.OP_RETURN) {
              _output.op_return_data = chunks[1].toString('hex')
            }

          }
          else {
            _output.script_type = "PAYTOWITNESS"
            _output.address = output.address
          }

          trezortx.outputs.push(_output)
        }
        console.log(trezortx)
        const resp = await TrezorConnect.signTransaction(trezortx)
        console.log(resp)
        if (resp.success == true) {
          txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, resp.payload.serializedTx)
          console.log(txInfo)
          console.log("tx ix")
        } else {
          console.log(resp.payload.error)
        }
      }
      else {
        const pendingTx = await sysjs.assetAllocationSend(txOpts, assetMap, null, new sys.utils.BN(item.fee * 1e8));
        txInfo = pendingTx.extractTransaction().getId();
      }

      updateTransactionData('confirmingTransaction', txInfo);
    } else {
      const _outputsArr = [
        { address: item.toAddress, value: new sys.utils.BN(item.amount * 1e8) }
      ];
      const txOpts = { rbf: item.rbf }
      let txInfo;
      if (account.isTrezorWallet) {
        console.log("Is trezor wallet")
        const changeAddress = await getNewChangeAddress();
        const psbt = await sysjs.createTransaction(txOpts, changeAddress, _outputsArr,
          new sys.utils.BN(item.fee * 1e8), account.xpub);
        if (!psbt) {
          console.log('Could not create transaction, not enough funds?')
        }

        console.log("PSBT response:")
        console.log("PSBT inputs")
        console.log(psbt.res.inputs)
        console.log("PSBT outputs")
        console.log(psbt.res.outputs)
        console.log("the psbt transact" + JSON.stringify(psbt))

        // TREZOR PART GOES UNDER NOW

        let trezortx: any = {};
        trezortx.coin = "sys"
        trezortx.version = psbt.res.txVersion
        trezortx.inputs = []
        trezortx.outputs = []

        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i]
          let _input: any = {}


          _input.address_n = convertToBip32Path(input.path)
          _input.prev_index = input.vout
          _input.prev_hash = input.txId
          if (input.sequence) _input.sequence = input.sequence
          _input.amount = input.value.toString()
          _input.script_type = 'SPENDWITNESS'
          trezortx.inputs.push(_input)
        }

        for (let i = 0; i < psbt.res.outputs.length; i++) {
          const output = psbt.res.outputs[i]
          let _output: any = {}

          _output.address = output.address
          _output.amount = output.value.toString()
          _output.script_type = "PAYTOWITNESS"
          trezortx.outputs.push(_output)
        }
        console.log(trezortx)
        const resp = await TrezorConnect.signTransaction(trezortx)
        console.log(resp)
        if (resp.success == true) {
          txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, resp.payload.serializedTx)
          console.log(txInfo)
        } else {
          console.log(resp.payload.error)
        }

      } else {
        const pendingTx = await sysjs.createTransaction(txOpts, null, _outputsArr, new sys.utils.BN(item.fee * 1e8));
        txInfo = pendingTx.extractTransaction().getId();

      }

      updateTransactionData('confirmingTransaction', txInfo);
    }

    item = null;

    watchMemPool();
  }

  const confirmTempTx = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(tempTx, confirmTransactionTx));

      tempTx = null;
    });
  };

  const getUserMintedTokens = async () => {
    let res;

    const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (!sysjs) {
      throw new Error('Error: no signed account exists.');
    }

    if (connectedAccount.isTrezorWallet) {
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, account.xpub, 'tokens=nonzero&details=txs', true);
    } else {
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'details=txs&assetMask=non-token-transfers', true, sysjs.HDSigner);
    }

    if (res.transactions) {
      const allTokens: any[] = [];
      let mintedTokens: MintedToken[] = [];

      await Promise.all(res.transactions.map(async (transaction: any) => {
        if (transaction.tokenType === 'SPTAssetActivate') {
          for (let token of transaction.tokenTransfers) {
            try {
              const response = await getDataAsset(token.token);

              allTokens.push({
                assetGuid: token.token,
                symbol: atob(token.symbol),
                maxSupply: Number(response.maxSupply),
                totalSupply: Number(response.totalSupply)
              });
            } catch (error) {
              console.log('Get data asset error: ');
              console.log(error);
            }
          }
        }

        return allTokens;
      }));

      allTokens.filter(function (el: any) {
        if (el != null) {
          let tokenExists: boolean = false;

          mintedTokens.forEach((element: any) => {
            if (element.assetGuid === el.assetGuid) {
              tokenExists = true
            }
          });

          if (!tokenExists) {
            mintedTokens.push(el);
          }
        }
      });

      return mintedTokens;
    }

    return;
  }

  const getHoldingsData = async () => {
    let assetsData: any = [];

    const connectedAccountAssetsData = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (connectedAccountAssetsData) {
      connectedAccountAssetsData.assets.map((asset: any) => {
        const {
          balance,
          type,
          decimals,
          symbol,
          assetGuid
        } = asset;

        const assetId = sys.utils.getBaseAssetID(assetGuid);

        const assetData = {
          balance,
          type,
          decimals,
          symbol,
          assetGuid,
          baseAssetID: assetId,
          nftAssetID: isNFT(assetGuid) ? sys.utils.createAssetID(assetId, assetGuid) : null
        }

        if (assetsData.indexOf(assetData) === -1) {
          assetsData.push(assetData);
        }

        return assetsData;
      });
    }

    return assetsData;
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
    console.log('info txid', await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid))
    return await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);
  }

  const getDataAsset = async (assetGuid: any) => {
    return await sys.utils.fetchBackendAsset(sysjs.blockbookURL, assetGuid);
  }

  const getSysExplorerSearch = () => {
    return sysjs.blockbookURL;
  }

  const confirmUpdateAsset = async (item: UpdateToken) => {
    const {
      fee,
      assetWhiteList,
      capabilityflags,
      contract,
      description,
      rbf,
      notarydetails,
      auxfeedetails,
      notaryAddress
    } = item;
    const feeRate = new sys.utils.BN(10);
    console.log('fee', fee, fee * 1e8)

    const txOpts = {
      rbf: rbf || true,
      assetWhiteList: assetWhiteList || null,
    };

    const assetGuid = item.assetGuid;

    console.log('data confirm update asset  item, feeRate, txOpts, assetGuid', item, feeRate, txOpts, assetGuid)

    let assetOpts = {
      updatecapabilityflags: capabilityflags || 127,
      description: 'lasldskd',
      contract: null,
      notarydetails,
      auxfeedetails,
      notarykeyid: Buffer.from('', 'hex')
    };

    if (contract) {
      assetOpts = {
        ...assetOpts,
        // @ts-ignore
        contract: Buffer.from(contract, 'hex')
      };
    }

    if (auxfeedetails) {
      const scalarPct = 1000;
      const keyPair = sysjs.HDSigner.createKeypair(0);
      const payment = sys.utils.bitcoinjs.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: sysjs.HDSigner.network
      })
      const auxfeekeyid = Buffer.from(payment.hash.toString('hex'), 'hex')

      assetOpts = {
        ...assetOpts,
        auxfeedetails: {
          auxfees: [
            {
              bound: new sys.utils.BN(0),
              percent: 1 * scalarPct
            }
          ],
          auxfeekeyid
        }
      };
    }

    if (notaryAddress) {
      const vNotaryPayment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: notaryAddress,
        network: sysjs.HDSigner.network
      });

      assetOpts = {
        ...assetOpts,
        notarykeyid: Buffer.from(vNotaryPayment.hash.toString('hex'), 'hex')
      }
    }

    console.log('asset opts update asset', assetOpts)

    const assetChangeAddress = null;

    const assetMap = new Map([
      [Number(assetGuid), {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(0),
          address: assetChangeAddress
        }]
      }]
    ]);

    console.log('asset map update asset', assetMap)

    const sysChangeAddress = null;

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, new sys.utils.BN(10));

    const txInfo = pendingTx.extractTransaction().getId();
    console.log('pendingTx', pendingTx)

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?');
    }

    updateTransactionData('updatingAsset', txInfo);

    watchMemPool();
  }

  const confirmUpdateAssetTransaction = () => {
    console.log('update asset item', updateAssetItem)

    return new Promise((resolve) => {
      resolve(handleTransactions(updateAssetItem, confirmUpdateAsset));

      updateAssetItem = null;
    });
  }

  const transferAsset = async (item: any) => {
    const feeRate = new sys.utils.BN(item.fee * 1e8);
    const txOpts = { rbf: item.rbf };
    const assetGuid = item.assetGuid;
    const assetOpts = {};
    let txInfo = null;

    const assetChangeAddress = null;
    const assetMap = new Map([
      [assetGuid, {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(0),
          address: item.newOwner
        }]
      }]
    ]);

    let sysChangeAddress: string | null = null;

    if (account.isTrezorWallet) {
      sysChangeAddress = await getNewChangeAddress();

      // @ts-ignore
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      let trezortx: any = {};
      trezortx.coin = "sys";
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        let _input: any = {};

        _input.address_n = convertToBip32Path(input.path);
        _input.prev_index = input.vout;
        _input.prev_hash = input.txId;

        if (input.sequence) _input.sequence = input.sequence;

        _input.amount = input.value.toString();
        _input.script_type = 'SPENDWITNESS';
        trezortx.inputs.push(_input);
      }

      for (let i = 0; i < psbt.res.outputs.length; i++) {
        const output = psbt.res.outputs[i];
        let _output: any = {};

        _output.amount = output.value.toString();

        if (output.script) {
          _output.script_type = "PAYTOOPRETURN";

          const chunks = bjs.script.decompile(output.script);

          if (chunks[0] === bitcoinops.OP_RETURN) {
            _output.op_return_data = chunks[1].toString('hex');
          }
        } else {
          _output.script_type = "PAYTOWITNESS";
          _output.address = output.address;
        }

        trezortx.outputs.push(_output);
      }

      const resp = await TrezorConnect.signTransaction(trezortx);

      if (resp.success == true) {
        txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, resp.payload.serializedTx);

        txInfo = psbt.extractTransaction().getId();

        updateTransactionData('transferringOwnership', txInfo);

        watchMemPool();
      }

      return;
    }

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?');
    }

    txInfo = pendingTx.extractTransaction().getId();

    updateTransactionData('transferringOwnership', txInfo);

    watchMemPool();
  }

  const confirmTransferOwnership = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(transferOwnershipData, transferAsset));

      transferOwnershipData = null;
    });
  }

  const getNewChangeAddress = async () => {
    const { activeAccountId, accounts } = store.getState().wallet;

    let address: string = '';
    let userAccount: IAccountState = accounts.find((el: IAccountState) => el.id === activeAccountId);

    if (userAccount!.isTrezorWallet) {
      const res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, userAccount.xpub, 'tokens=nonzero&details=txs', true);

      let TrezorAccount = new fromZPub(userAccount.xpub, sysjs.HDSigner.pubTypes, sysjs.HDSigner.networks);
      let receivingIndex: number = -1;
      let changeIndex: number = -1;

      if (res.tokens) {
        res.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/');

            if (splitPath.length >= 6) {
              const change = parseInt(splitPath[4], 10);
              const index = parseInt(splitPath[5], 10);

              if (change === 1) {
                changeIndex = index;

                return;
              }

              if (index > receivingIndex) {
                receivingIndex = index;
              }
            }
          }
        });
      }

      address = TrezorAccount.getAddress(changeIndex + 1, true);

      return address;
    }

    console.error("Let HDsignet handle change address for non trezor wallets");

    return null;
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
    getNewUpdateAsset,
    getNewOwnership,
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
    getDataFromWalletToMintNFT,
    setDataFromPageToUpdateAsset,
    getDataFromPageToUpdateAsset,
    setDataFromWalletToUpdateAsset,
    getDataFromWalletToUpdateAsset,
    setDataFromPageToTransferOwnership,
    getDataFromPageToTransferOwnership,
    setDataFromWalletToTransferOwnership,
    getDataFromWalletToTransferOwnership,
    confirmUpdateAssetTransaction,
    confirmTransferOwnership,
    setUpdateAsset,
    setNewOwnership,
    getHoldingsData,
    getDataAsset
  };
};

export default AccountController;