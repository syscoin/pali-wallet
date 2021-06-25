import TrezorConnect from 'trezor-connect';
import store from 'state/store';
// import https from 'https';
import IWalletState, {
  IAccountState
} from 'state/wallet/types';
import { bech32 } from 'bech32';
import { sys } from 'constants/index';
import { fromZPub } from 'bip84';
// import { SingleEntryPlugin } from 'webpack';
import {
  createAccount,
  updateStatus,
  updateAccount,
  updateLabel,
  updateTransactions,
  updateAccountAddress,
  updateAccountXpub,
  updateSwitchNetwork
} from 'state/wallet';
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

const bjs = require('bitcoinjs-lib');
const bitcoinops = require('bitcoin-ops');
const syscointx = require('syscointx-js');

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
  // let newIssueNFT: any;
  let collection: any;
  let dataFromPageToCreateSPT: ISPTPageInfo;
  let dataFromWalletToCreateSPT: ISPTWalletInfo;
  let dataFromPageToMintSPT: ISPTIssuePage;
  let dataFromWalletToMintSPT: ISPTIssueWallet;
  let dataFromPageToMintNFT: INFTPageInfo;
  let dataFromWalletToMintNFT: INFTWalletInfo;
  let dataFromWalletToUpdateAsset: UpdateTokenWalletInfo;
  let dataFromPageToUpdateAsset: UpdateTokenPageInfo;
  let dataFromWalletToTransferOwnership: any;
  let dataFromPageToTransferOwnership: any;
  let resAddress: any;
  let encode: any;

  const _coventPendingType = (txid: string) => {
    return {
      txid: txid,
      value: 0,
      confirmations: 0,
      fees: 0,
      blockTime: Date.now() / 1e3,
    } as Transaction;
  };

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
      let receivingIndex: number = -1;

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
          xprv: "",
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
      id: sysjs.HDSigner.accountIndex === 0 ? 0 : sysjs.HDSigner.accountIndex + 1,
      label: label || `Account ${sysjs.HDSigner.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.HDSigner.getAccountXpub(),
      xprv: sysjs.HDSigner.accounts[sysjs.HDSigner.accountIndex].getAccountPrivateKey(),
      address: { 'main': await sysjs.HDSigner.getNewReceivingAddress() },
      assets: res.assets,
      connectedTo: [],
      isTrezorWallet: false
    };

    store.dispatch(createAccount(account));

    return account!.xpub;
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

      store.dispatch(updateSwitchNetwork(false))

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

    store.dispatch(updateSwitchNetwork(false))
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

      console.log('account', account)
    }

    console.log('account', account)
  };

  const watchMemPool = () => {
    if (intervalId) {
      return true;
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

        return false;
      }

      return;
    }, 30 * 1000);

    return true;
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

  const updateTxs = () => {
    if (!account) {
      return;
    }

    getLatestUpdate();
  };
  
  const clearTransactionItem = (item: string) => {
    switch (item) {
      case 'newSPT':
        newSPT = null;
        break;
      case 'mintNFT':
        mintNFT = null;
        break;
      case 'mintSPT':
        mintSPT = null;
        break;
      case 'transferOwnershipData':
        transferOwnershipData = null;
        break;
      case 'updateAssetItem':
        updateAssetItem = null;
        break;
      case 'tempTx':
        tempTx = null;
        break;
      default:
        return null;
    }
    
    return;
  }

  const getTransactionItem = () => {
    return {
      tempTx: tempTx || null,
      newSPT: newSPT || null,
      mintSPT: mintSPT || null,
      mintNFT: mintNFT || null,
      updateAssetItem: updateAssetItem || null,
      transferOwnershipData: transferOwnershipData || null
    };
  }

  const getTempTx = () => {
    console.log('temptx', tempTx)
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
    console.log('update asset item', updateAssetItem)
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

  const setNewXpub = (id: number, xpub: string, xprv: string) => {
    store.dispatch(
      updateAccountXpub({
        id: id,
        xpub: xpub,
        xprv: xprv
      })
    );

    return true;
  }

  // const setDataFromPageToInitTransaction = (data: any, variableItem: any) => {
  //   variableItem = data;
  // }

  const getDataFromPageToInitTransaction = () => {
    return {
      dataFromPageToCreateSPT: dataFromPageToCreateSPT || null,
      dataFromWalletToCreateSPT: dataFromWalletToCreateSPT || null,
      dataFromPageToMintSPT: dataFromPageToMintSPT || null,
      dataFromWalletToMintSPT: dataFromWalletToMintSPT || null,
      dataFromPageToMintNFT: dataFromPageToMintNFT || null,
      dataFromWalletToMintNFT: dataFromWalletToMintNFT || null,
      dataFromPageToUpdateAsset: dataFromPageToUpdateAsset || null,
      dataFromWalletToUpdateAsset: dataFromWalletToUpdateAsset || null,
      dataFromPageToTransferOwnership: dataFromPageToTransferOwnership || null,
      dataFromWalletToTransferOwnership: dataFromWalletToTransferOwnership || null
    }
  }

  const setDataFromPageToCreateNewSPT = (data: ISPTPageInfo) => {
    console.log('data from page to create spt', data)
    dataFromPageToCreateSPT = data;
  }

  const setDataFromWalletToCreateSPT = (data: ISPTWalletInfo) => {
    dataFromWalletToCreateSPT = data;
  }

  const setDataFromPageToMintSPT = (data: ISPTIssuePage) => {
    console.log('new mint page spt', data)
    dataFromPageToMintSPT = data;
  }

  const setDataFromWalletToMintSPT = (data: ISPTIssueWallet) => {
    console.log('new  wallet spt', data)
    dataFromWalletToMintSPT = data;
  }

  const setDataFromPageToMintNFT = (data: INFTPageInfo) => {
    dataFromPageToMintNFT = data;
  }

  const setDataFromWalletToMintNFT = (data: INFTWalletInfo) => {
    dataFromWalletToMintNFT = data;
  }

  const setDataFromPageToUpdateAsset = (data: UpdateTokenPageInfo) => {
    console.log('data from page update asset item', data)
    dataFromPageToUpdateAsset = data;
  }

  const setDataFromWalletToUpdateAsset = (data: UpdateTokenWalletInfo) => {
    console.log('data from wallet update asset item', data)
    dataFromWalletToUpdateAsset = data;
  }

  const setDataFromPageToTransferOwnership = (data: any) => {
    dataFromPageToTransferOwnership = data;
  }

  const setDataFromWalletToTransferOwnership = (data: any) => {
    dataFromWalletToTransferOwnership = data;
  }

  const createSPT = (spt: ISPTInfo) => {
    newSPT = spt;
    console.log('new spt', spt)

    return true;
  }

  const issueSPT = (spt: ISPTIssue) => {
    console.log('new mint spt', spt)
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

  // const setNewIssueNFT = (data: any) => {
  //   newIssueNFT = data;

  //   return;
  // }

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

    const newMaxSupply = maxsupply * (10 ** precision);

    let _assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(newMaxSupply),
      description,
      updatecapabilityflags: capabilityflags || '127',
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


  // const getAssetSharesData = (precision: number) => {
  //   let shares: string;
  //   let coin: number;

  //   switch (precision) {
  //     case 0:
  //       shares = "1";
  //       coin = 1;
  //       break;
  //     case 1:
  //       shares = "10";
  //       coin = 10;
  //       break;
  //     case 2:
  //       shares = "100";
  //       coin = 100;
  //       break;
  //     case 3:
  //       shares = "1,000";
  //       coin = 1000;
  //       break;
  //     case 4:
  //       shares = "10,000";
  //       coin = 10000;
  //       break;
  //     case 5:
  //       shares = "100,000";
  //       coin = 100000;
  //       break;
  //     case 6:
  //       shares = "1,000,000";
  //       coin = 1000000;
  //       break;
  //     case 7:
  //       shares = "10,000,000";
  //       coin = 10000000;
  //       break;
  //     case 8:
  //       shares = "100,000,000";
  //       coin = 100000000;
  //       break;
  //     default:
  //       throw new Error("ERROR: Must specify precision between 0 and 8.");
  //   }

  //   return {
  //     kShares: shares,
  //     kCoin: coin
  //   };
  // }

  const createParentAsset = async (assetOpts: any, fee: number, rbf: boolean) => {
    const xpub: any = await sysjs.HDSigner.getAccountXpub();
    console.log("Root xpub: " + xpub);

    const txOpts: any = { rbf };

    const feeRate = new sys.utils.BN(fee * 1e8)


    console.log('asset opts parent child', assetOpts, fee, feeRate)

    const psbt = await sysjs.assetNew(assetOpts, txOpts, null, null, feeRate);

    if (!psbt) {
      console.log('Could not create transaction, not enough funds?');

      return;
    }

    const assets = syscointx.getAssetsFromTx(psbt.extractTransaction());

    const endResult = { asset_guid: assets.keys().next().value };

    console.log('end result', endResult);

    console.log('psbt asset new', psbt)

    const txInfo = psbt.extractTransaction().getId();

    console.log('tx info', txInfo)

    return {
      asset_guid: assets.keys().next().value,
      txid: txInfo
    };
  }

  // const issueBlankChildNFTs = async (parentAssetGuid: string, qty: number, startNFTID: number, receivingAddress: string, feeRate: number, rbf: boolean) => {
  //   const xpub = await sysjs.HDSigner.getAccountXpub();
  //   console.log("Root xpub: " + xpub);

  //   if (qty > 50) {
  //     throw new Error('ERROR: We are limiting the max quantity to 50 blank NFTs per execution. Let\'s be good stewards of the blockchain and not add much bloat.');
  //   }

  //   if ((startNFTID + qty) > 4294967295) {
  //     throw new Error('ERROR: NFTID may not exceed value 4294967295. Your arguments increment beyond this value.');
  //   }

  //   const newParentAssetGuid = parentAssetGuid.toString();

  //   const txOpts = {
  //     rbf,
  //     assetWhiteList: new Map([[parentAssetGuid, {}]])
  //   };

  //   console.log('issue blank params', parentAssetGuid, qty, startNFTID, receivingAddress, feeRate, rbf)

  //   const assetChangeAddress = null;
  //   const sysChangeAddress = null;

  //   let assetArray: any[] = [];

  //   let backendIsSynced = await axios.get(`${sysjs.blockbookURL}/api/v2`, { httpsAgent: agent });

  //   console.log('request backend is synced', backendIsSynced)

  //   if (backendIsSynced.data.blockbook.inSync == true && backendIsSynced.data.blockbook.syncMode == true) {
  //     for (let i = startNFTID; i <= startNFTID + qty; i++) {
  //       let parentAsset = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${newParentAssetGuid}`, { httpsAgent: agent });
  //       console.log(parentAsset.data)

  //       const sharesData = await getAssetSharesData(parentAsset.data.asset.decimals);

  //       console.log('shares data', sharesData)

  //       const childAssetGuid = sys.utils.createAssetID(i, parentAssetGuid);

  //       console.log('i from startnftid childassetguid', i, childAssetGuid)

  //       const NFTAssetIdAlreadyExists = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${childAssetGuid}`, { httpsAgent: agent });

  //       console.log(`making sure nft ${childAssetGuid} does not exist on-chain`);

  //       if (NFTAssetIdAlreadyExists.data.error === 'Asset not found') {
  //         assetArray.push(
  //           [Number(childAssetGuid), {
  //             changeAddress: assetChangeAddress,
  //             outputs: [{
  //               value: new sys.utils.BN('20000'),
  //               address: receivingAddress
  //             }]
  //           }]
  //         );

  //         return;
  //       }

  //       console.log(`nftid ${i} already exists on-chain for parent asset ${parentAssetGuid}`)
  //     }

  //     if (assetArray.length > 0) {
  //       console.log(`committing ${assetArray.length} to the blockchain`);

  //       const assetMap = new Map(assetArray);

  //       const psbt = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

  //       if (!psbt) {
  //         console.log('Could not create transaction, not enough funds?');
  //       }

  //       const onChainChildAssetGuids = syscointx.getAllocationsFromTx(psbt.extractTransaction());

  //       return onChainChildAssetGuids;
  //     }

  //     console.log('Nothing to commit to the blockchain!');
  //   }

  //   console.log('backend is not synced. give it time to sync, then try again');
  // }

  // const sendChildNFTtoCreator = async (nftGuid: string, receivingAddress: string, feeRate: number, rbf: boolean) => {
  //   const xpub = await sysjs.HDSigner.getAccountXpub();
  //   console.log("Root xpub: " + xpub);

  //   const NFTguid = nftGuid.toString();
  //   const asset = await axios.get(`${sysjs.blockbookURL}/api/v2/asset/${NFTguid}`, { httpsAgent: agent });

  //   console.log('request asset', asset)
  //   const sharesData = await getAssetSharesData(asset.data.asset.decimals);
  //   const satoshiAmount = (1 * sharesData.kCoin).toString();

  //   const txOpts = {
  //     rbf,
  //     assetWhiteList: new Map([[NFTguid, {}]])
  //   };

  //   const assetChangeAddress = null;
  //   const sysChangeAddress = null;

  //   const assetMap = new Map([
  //     [NFTguid, {
  //       changeAddress: assetChangeAddress,
  //       outputs: [{
  //         value: new sys.utils.BN(satoshiAmount),
  //         address: receivingAddress
  //       }]
  //     }]
  //   ]);

  //   const psbt = await sysjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate);

  //   if (!psbt) {
  //     console.log('Could not create transaction, not enough funds?')
  //   }

  //   for (let output in psbt.txOutputs) {
  //     console.log("The psbt txOutput: " + (psbt.txOutputs[output]))
  //   }
  // }



  //This function executs do multiples transactions in sys blockchain  which must be executed in series
  // WARNING: It might take a few minutes to execute it be carefull when using it
  const confirmMintNFT = async (item: any) => {
    const {
      fee,
      rbf,
      symbol,
      description,
      issuer,
      totalShares,
      // notary,
      // notarydetails,
      // auxfeedetails,
      // notaryAddress,
      // payoutAddress
    } = item;

    const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (connectedAccount.isTrezorWallet) {
      throw new Error('trezor does not support nft creation')
    }


    let assetOpts = {
      precision: totalShares,
      symbol,
      maxsupply: new sys.utils.BN(1 * (10 ** totalShares)),
      description
    }
    console.log("total shares: ", totalShares)
    console.log("creating parent asset:, ", assetOpts)
    // console.log("feeRate to parent:", feeRate)
    const newParentAsset = await createParentAsset(assetOpts, fee, rbf);

    if (newParentAsset?.asset_guid) {
      console.log("Checking new parent asset id")
      console.log(newParentAsset?.asset_guid)
      let theNFTTx: any = null
      let parentConfirmed = false
      let txInfo: any = null
      try {
        return new Promise((resolve) => {
          let interval: any;

          interval = setInterval(async () => {
            const newParentTx = await getTransactionInfoByTxId(newParentAsset.txid);
            const feeRate = new sys.utils.BN(fee * 1e8);
            const txOpts = { rbf: Boolean(rbf) || true }
            if (newParentTx.confirmations > 1 && !parentConfirmed) {
              parentConfirmed = true
              console.log("newParentAsset: ", newParentAsset)
              console.log('the total shares amount: ', totalShares)
              const assetMap = new Map([
                [newParentAsset!.asset_guid, { changeAddress: null, outputs: [{ value: new sys.utils.BN(1 * (10 ** totalShares)), address: issuer }] }]
              ])
              let sysChangeAddress = null;

              try {
                const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);
                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?')
                }

                txInfo = pendingTx.extractTransaction().getId();
                console.log("Transaction sucess", txInfo)
                updateTransactionData('issuingNFT', txInfo);
                theNFTTx = txInfo;
                console.log(theNFTTx)
                // clearInterval(interval)
                // resolve('transaction ok')
              }
              catch (error) {
                console.log("error creating nft" + error)
                console.log("trying again...")
                parentConfirmed = false
              }
            }
            else if (theNFTTx && txInfo) {
              try {
                theNFTTx = await getTransactionInfoByTxId(txInfo);
              }
              catch (error) {
                console.log("Transaction still not indexed by explorer: ", error)
                return
              }
              if (theNFTTx.confirmations > 1) {
                console.log("child tx time bb")
                const feeRate = new sys.utils.BN(10)
                const txOpts = { rbf: rbf || true }
                const assetGuid = newParentAsset!.asset_guid
                // update capability flags, update description and update eth smart contract address
                const assetOpts = { updatecapabilityflags: '0' }
                // send asset back to ourselves as well as any change
                const assetChangeAddress = null
                // send change back to ourselves as well as recipient to ourselves
                const assetMap = new Map([
                  [assetGuid, { changeAddress: assetChangeAddress, outputs: [{ value: new sys.utils.BN(0), address: assetChangeAddress }] }]
                ])
                // if SYS need change sent, set this address. null to let HDSigner find a new address for you
                const sysChangeAddress = null
                const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate)
                if (!psbt) {
                  console.log('Could not create transaction, not enough funds?')
                }
                clearInterval(interval)
                resolve('transaction ok')
                return
              }
              else {
                console.log('confirming child transactions', theNFTTx, theNFTTx.confirmations)

              }
            }

            else {
              console.log('confirming transactions', newParentTx, newParentTx.confirmations)
            }
          }, 16000);
        })
      } catch (error) {
        console.log('error sending child nft to creator', error)
      }
    }

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

    tempTx = null;

    watchMemPool();
  }

  const confirmTempTx = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(tempTx, confirmTransactionTx));
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
      assetGuid,
      assetWhiteList,
      capabilityflags,
      contract,
      description,
      rbf,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    } = item;

    let txOpts: any = {
      rbf: rbf || true
    };

    let assetOpts: any = {
      updatecapabilityflags: String(capabilityflags),
      description
    };

    if (assetWhiteList) {
      txOpts = {
        ...txOpts,
        assetWhiteList: assetWhiteList,
      };
    }

    if (notarydetails) {
      assetOpts = {
        ...assetOpts,
        notarydetails,
        auxfeedetails,
        notarykeyid: null
      }
    }

    if (contract) {
      assetOpts = {
        ...assetOpts,
        contract: Buffer.from(contract, 'hex')
      };
    }

    if (auxfeedetails) {
      const scalarPct = 1000;
      const payment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: payoutAddress,
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

    const thisAssetMap = new Map([
      [assetGuid, {
        changeAddress: null,
        outputs: [{
          value: new sys.utils.BN(0),
          address: null
        }]
      }]
    ]);

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, thisAssetMap, null, new sys.utils.BN(fee * 1e8));

    const txInfo = pendingTx.extractTransaction().getId();

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?');
    }

    updateTransactionData('updatingAsset', txInfo);

    watchMemPool();
  }

  const confirmUpdateAssetTransaction = () => {
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
    const newOwner = item.newOwner;

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: newOwner,
        outputs: [{
          value: new sys.utils.BN(0),
          address: newOwner
        }]
      }]
    ]);

    if (account.isTrezorWallet) {
      let sysChangeAddress = await getNewChangeAddress();

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

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, newOwner, feeRate);

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
    updateAccountLabel,
    addNewAccount,
    getLatestUpdate,
    watchMemPool,
    getTempTx,
    updateTempTx,
    confirmTempTx,
    isValidSYSAddress,
    updateTxs,
    getTransactionItem,
    getRecommendFee,
    setNewAddress,
    setNewXpub,
    isNFT,
    getDataFromPageToInitTransaction,
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
    setDataFromWalletToCreateSPT,
    setDataFromPageToMintSPT,
    setDataFromWalletToMintSPT,
    setDataFromPageToMintNFT,
    setDataFromWalletToMintNFT,
    setDataFromPageToUpdateAsset,
    setDataFromWalletToUpdateAsset,
    setDataFromPageToTransferOwnership,
    setDataFromWalletToTransferOwnership,
    confirmUpdateAssetTransaction,
    confirmTransferOwnership,
    setUpdateAsset,
    setNewOwnership,
    getHoldingsData,
    getDataAsset,
    clearTransactionItem
  };
};

export default AccountController;