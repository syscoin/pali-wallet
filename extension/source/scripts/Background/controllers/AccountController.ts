import TrezorConnect from 'trezor-connect';
import store from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { bech32 } from 'bech32';
import { sys } from 'constants/index';
import { fromZPub } from 'bip84';
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

  const convertToBip32Path = (address: string) => {
    let addressArray: String[] = address.replace(/'/g, '').split('/');

    addressArray.shift();

    let addressItem: Number[] = [];

    for (let index in addressArray) {
      if (Number(index) <= 2 && Number(index) >= 0) {
        addressItem[Number(index)] = Number(addressArray[index]) | 0x80000000;

        return;
      }

      addressItem[Number(index)] = Number(addressArray[index]);
    }

    return addressItem;
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
      console.log(connectedAccountAssetsData.assets, connectedAccountAssetsData.transactions)
      await Promise.all(connectedAccountAssetsData.assets.map(async (asset: any) => {
        const {
          balance,
          type,
          decimals,
          symbol,
          assetGuid
        } = asset;

        const assetId = sys.utils.getBaseAssetID(assetGuid);
        const dataAsset = await getDataAsset(assetGuid);

        const assetData = {
          balance,
          type,
          decimals,
          symbol,
          assetGuid,
          baseAssetID: assetId,
          nftAssetID: isNFT(assetGuid) ? sys.utils.createAssetID(assetId, assetGuid) : null,
          description: atob(dataAsset.pubData.desc)
        }

        if (assetsData.indexOf(assetData) === -1) {
          assetsData.push(assetData);
        }

        return assetsData;
      }));
    }

    return assetsData;
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

    console.error('Let HDsignet handle change address for non trezor wallets');

    return null;
  }

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
  };

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
      res = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.HDSigner.getAccountXpub(), 'tokens=nonzero&details=txs', true);
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
          xprv: '',
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
      await sysjs.HDSigner.createAccount();
    }

    const res: IAccountInfo | null = await getAccountInfo();

    account = {
      id: sysjs.HDSigner.accountIndex === 0 ? 0 : sysjs.HDSigner.accountIndex,
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
      sysjs.HDSigner.setAccountIndex(activeAccountId);

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
    }
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
  };

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

  const handleTransactions = async (item: any, executeTransaction: any) => {
    if (!sysjs) {
      throw new Error('Error: No signed account exists');
    }

    if (!account) {
      throw new Error('Error: Can\'t find active account info');
    }

    if (!item) {
      throw new Error('Error: Can\'t find item info');
    }

    return new Promise((resolve: any, reject: any) => {
      executeTransaction(item)
        .then((response: any) => {
          resolve(response);
        })
        .catch((error: any) => {
          reject(error);
        });
    });
  };

  const confirmSPTCreation = async (item: any) => {
    const {
      capabilityflags,
      notarydetails,
      auxfeedetails,
      precision,
      symbol,
      description,
      initialSupply,
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
      description,
      maxsupply: new sys.utils.BN(newMaxSupply),
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

    const txOpts = { rbf: Boolean(rbf) || true };

    const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (connectedAccount.isTrezorWallet) {
      throw new Error('Trezor don\'t support burning of coins');
    }

    const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, null, null, new sys.utils.BN(fee * 1e8));

    let txInfoNew = pendingTx.extractTransaction().getId();

    updateTransactionData('creatingAsset', txInfoNew);

    const transactionData = await getTransactionInfoByTxId(txInfoNew);

    if (initialSupply && initialSupply < newMaxSupply) {
      try {
        return new Promise(async (resolve: any, reject: any) => {
          let interval: any;

          interval = setInterval(async () => {
            const sptCreated = await getTransactionInfoByTxId(txInfoNew);

            if (sptCreated?.confirmations > 1) {
              console.log('confirmations > 1', sptCreated!.tokenTransfers)

              try {
                const assetMap = new Map([
                  [String(sptCreated!.tokenTransfers[1].token), {
                    changeAddress: null,
                    outputs: [{
                      value: new sys.utils.BN(initialSupply * (10 ** precision)),
                      address: null
                    }]
                  }]
                ]);

                const pendingTx = await sysjs.assetSend(txOpts, assetMap, null, new sys.utils.BN(fee * 1e8));

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?')
                }

                const txInfo = pendingTx.extractTransaction().getId();

                updateTransactionData('issuingSPT', txInfo);

                watchMemPool();

                clearInterval(interval);

                resolve({
                  sptCreated,
                  txConfirmations: sptCreated.confirmations,
                  txAssetGuid: sptCreated.tokenTransfers[0].token
                });
              } catch (error) {
                clearInterval(interval);

                reject(error);
              }
            }
          }, 16000);
        });
      } catch (error) {
        console.log(error);

        return error;
      }
    }

    return {
      transactionData,
      txConfirmations: transactionData.confirmations,
      txAssetGuid: transactionData.tokenTransfers[0].token
    }
  };

  const confirmNewSPT = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(newSPT, confirmSPTCreation).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error);
      });

      newSPT = null;
    });
  };

  const confirmMintSPT = async (item: any) => {
    const {
      fee,
      rbf,
      assetGuid,
      amount
    } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf };
    const assetChangeAddress = null;

    let txInfo;

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(amount * 1e8),
          address: assetChangeAddress
        }]
      }]
    ]);

    let sysChangeAddress = null;

    const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (connectedAccount.isTrezorWallet) {
      sysChangeAddress = await getNewChangeAddress();
      // @ts-ignore: Unreachable code error
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const psbt = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate, account.xpub);

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      let trezortx: any = {};

      trezortx.coin = 'sys';
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        let inputItem: any = {};

        inputItem.address_n = convertToBip32Path(input.path);
        inputItem.prev_index = input.vout;
        inputItem.prev_hash = input.txId;

        if (input.sequence) inputItem.sequence = input.sequence;

        inputItem.amount = input.value.toString();
        inputItem.script_type = 'SPENDWITNESS';

        trezortx.inputs.push(inputItem);
      }

      for (let i = 0; i < psbt.res.outputs.length; i++) {
        const output = psbt.res.outputs[i];
        let outputItem: any = {};

        outputItem.amount = output.value.toString();

        if (output.script) {
          outputItem.script_type = 'PAYTOOPRETURN';

          const chunks = bjs.script.decompile(output.script);

          if (chunks[0] === bitcoinops.OP_RETURN) {
            outputItem.op_return_data = chunks[1].toString('hex');
          }
        } else {
          outputItem.script_type = 'PAYTOWITNESS';
          outputItem.address = output.address;
        }

        trezortx.outputs.push(outputItem);
      }

      const response = await TrezorConnect.signTransaction(trezortx);

      if (response.success == true) {
        txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, response.payload.serializedTx);

        return;
      }

      console.log(response.payload.error);
    } else {
      const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?')
      }

      txInfo = pendingTx.extractTransaction().getId();
    }

    updateTransactionData('issuingSPT', txInfo);

    watchMemPool();
  };

  const confirmIssueSPT = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(mintSPT, confirmMintSPT));

      mintSPT = null;
    });
  };

  const createParentAsset = async (assetOpts: any, fee: number, rbf: boolean) => {
    const txOpts: any = { rbf };
    const feeRate = new sys.utils.BN(fee * 1e8);

    const psbt = await sysjs.assetNew(assetOpts, txOpts, null, null, feeRate);

    if (!psbt) {
      console.log('Could not create transaction, not enough funds?');

      return;
    }

    const assets = syscointx.getAssetsFromTx(psbt.extractTransaction());
    const txInfo = psbt.extractTransaction().getId();

    return {
      asset_guid: assets.keys().next().value,
      txid: txInfo
    };
  };

  /**
   * This function executs do multiples transactions in sys blockchain  which must be executed in series
   * WARNING: It might take a few minutes to execute it be carefull when using it
   */

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
      throw new Error('trezor does not support nft creation');
    }

    let assetOpts = {
      precision: totalShares,
      symbol,
      maxsupply: new sys.utils.BN(1 * (10 ** totalShares)),
      description
    }

    const newParentAsset = await createParentAsset(assetOpts, fee, rbf);

    if (newParentAsset?.asset_guid) {
      let theNFTTx: any = null;
      let parentConfirmed: boolean = false;
      let txInfo: any = null;

      try {
        return new Promise((resolve) => {
          let interval: any;

          interval = setInterval(async () => {
            const newParentTx = await getTransactionInfoByTxId(newParentAsset.txid);
            const feeRate = new sys.utils.BN(fee * 1e8);
            const txOpts = { rbf: Boolean(rbf) || true };

            if (newParentTx.confirmations > 1 && !parentConfirmed) {
              parentConfirmed = true;

              const assetMap = new Map([
                [newParentAsset!.asset_guid,
                {
                  changeAddress: null,
                  outputs: [{
                    value: new sys.utils.BN(1 * (10 ** totalShares)),
                    address: issuer
                  }]
                }]
              ]);

              let sysChangeAddress = null;

              try {
                const pendingTx = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate);

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?')
                }

                txInfo = pendingTx.extractTransaction().getId();

                updateTransactionData('issuingNFT', txInfo);

                theNFTTx = txInfo;
              } catch (error) {
                console.log('error creating nft', error);

                parentConfirmed = false;
              }

              return;
            }

            if (theNFTTx && txInfo) {
              try {
                theNFTTx = await getTransactionInfoByTxId(txInfo);
              } catch (error) {
                console.log('Transaction still not indexed by explorer:', error);

                return;
              }

              if (theNFTTx.confirmations > 1) {
                const feeRate = new sys.utils.BN(10);
                const txOpts = { rbf: rbf || true };
                const assetGuid = newParentAsset!.asset_guid;
                const assetOpts = { updatecapabilityflags: '0' };
                const assetChangeAddress = null;

                const assetMap = new Map([
                  [assetGuid, {
                    changeAddress: assetChangeAddress,
                    outputs: [{
                      value: new sys.utils.BN(0),
                      address: assetChangeAddress
                    }]
                  }]
                ]);

                const sysChangeAddress = null;

                const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

                if (!psbt) {
                  console.log('Could not create transaction, not enough funds?')
                }

                clearInterval(interval);

                resolve('transaction ok');

                return;
              }

              console.log('confirming child transactions', theNFTTx, theNFTTx.confirmations);

              return;
            }

            console.log('confirming transactions', newParentTx, newParentTx.confirmations);
          }, 16000);
        });
      } catch (error) {
        console.log('error sending child nft to creator', error);
      }
    }
  };

  const confirmIssueNFT = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(mintNFT, confirmMintNFT));

      mintNFT = null;
    });
  };

  const confirmTransactionTx = async (
    items: {
      fromAddress: string,
      toAddress: string,
      amount: number,
      fee: number,
      token: any,
      isToken: boolean,
      rbf: boolean
    }
  ) => {
    const {
      toAddress,
      amount,
      fee,
      token,
      isToken,
      rbf
    } = items;

    if (isToken && token) {
      let txInfo;

      const txOpts = { rbf };
      const value = isNFT(token.assetGuid) ? new sys.utils.BN(amount) : new sys.utils.BN(amount * 10 ** token.decimals);

      const assetMap = new Map([
        [token.assetGuid, {
          changeAddress: null,
          outputs: [{
            value: value,
            address: toAddress
          }]
        }]
      ]);

      if (account.isTrezorWallet) {
        const changeAddress = await getNewChangeAddress();
        // @ts-ignore: Unreachable code error
        assetMap.get(token.assetGuid)!.changeAddress = changeAddress;

        const psbt = await sysjs.assetAllocationSend(txOpts, assetMap, changeAddress, new sys.utils.BN(fee * 1e8), account.xpub);

        if (!psbt) {
          console.log('Could not create transaction, not enough funds?')
        }

        let trezortx: any = {};

        trezortx.coin = 'sys';
        trezortx.version = psbt.res.txVersion;
        trezortx.inputs = [];
        trezortx.outputs = [];

        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i];
          let inputItem: any = {};

          inputItem.address_n = convertToBip32Path(input.path);
          inputItem.prev_index = input.vout;
          inputItem.prev_hash = input.txId;

          if (input.sequence) inputItem.sequence = input.sequence;

          inputItem.amount = input.value.toString();
          inputItem.script_type = 'SPENDWITNESS';

          trezortx.inputs.push(inputItem);
        }

        for (let i = 0; i < psbt.res.outputs.length; i++) {
          const output = psbt.res.outputs[i];
          let outputItem: any = {};

          outputItem.amount = output.value.toString();

          if (output.script) {
            outputItem.script_type = 'PAYTOOPRETURN';

            const chunks = bjs.script.decompile(output.script);

            if (chunks[0] === bitcoinops.OP_RETURN) {
              outputItem.op_return_data = chunks[1].toString('hex');
            }
          } else {
            outputItem.script_type = 'PAYTOWITNESS';
            outputItem.address = output.address;
          }

          trezortx.outputs.push(outputItem);
        }

        const response = await TrezorConnect.signTransaction(trezortx);

        if (response.success == true) {
          txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, response.payload.serializedTx);

          return;
        }

        console.log(response.payload.error);
      } else {
        const pendingTx = await sysjs.assetAllocationSend(txOpts, assetMap, null, new sys.utils.BN(fee * 1e8));

        txInfo = pendingTx.extractTransaction().getId();
      }

      updateTransactionData('confirmingTransaction', txInfo);
    } else {
      const outputsArray = [{ 
        address: toAddress, 
        value: new sys.utils.BN(amount * 1e8) 
      }];

      const txOpts = { rbf };
      let txInfo;

      if (account.isTrezorWallet) {
        const changeAddress = await getNewChangeAddress();
        const psbt = await sysjs.createTransaction(txOpts, changeAddress, outputsArray, new sys.utils.BN(fee * 1e8), account.xpub);

        if (!psbt) {
          console.log('Could not create transaction, not enough funds?')
        }

        let trezortx: any = {};

        trezortx.coin = 'sys';
        trezortx.version = psbt.res.txVersion;
        trezortx.inputs = [];
        trezortx.outputs = [];

        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i];
          let inputItem: any = {};

          inputItem.address_n = convertToBip32Path(input.path);
          inputItem.prev_index = input.vout;
          inputItem.prev_hash = input.txId;

          if (input.sequence) inputItem.sequence = input.sequence;

          inputItem.amount = input.value.toString();
          inputItem.script_type = 'SPENDWITNESS';

          trezortx.inputs.push(inputItem);
        }

        for (let i = 0; i < psbt.res.outputs.length; i++) {
          const output = psbt.res.outputs[i];
          let outputItem: any = {};

          outputItem.address = output.address;
          outputItem.amount = output.value.toString();

          outputItem.script_type = 'PAYTOWITNESS';

          trezortx.outputs.push(outputItem);
        }

        const resp = await TrezorConnect.signTransaction(trezortx);

        if (resp.success == true) {
          txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, resp.payload.serializedTx);

          return;
        }

        console.log(resp.payload.error);
      } else {
        const pendingTx = await sysjs.createTransaction(txOpts, null, outputsArray, new sys.utils.BN(fee * 1e8));

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

    console.log('asset opts update asset', assetOpts, assetGuid)

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
    return new Promise((resolve, reject) => {
      handleTransactions(updateAssetItem, confirmUpdateAsset).then((response) => {
        console.log('transaction ok response', response)

        resolve(response)
      }).catch((error) => {
        console.log('error', error)

        reject(error)
      });

      updateAssetItem = null;
    });
  }

  const transferAsset = async (item: any) => {
    const {
      fee,
      rbf,
      assetGuid,
      newOwner
    } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf };
    const assetOpts = {};

    let txInfo = null;

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: newOwner,
        outputs: [{
          value: new sys.utils.BN(0),
          address: newOwner
        }]
      }]
    ]);

    const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: any) => {
        return url == new URL(store.getState().wallet.currentURL).host;
      });
    });

    if (connectedAccount.isTrezorWallet) {
      let sysChangeAddress = await getNewChangeAddress();

      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      let trezortx: any = {};

      trezortx.coin = 'sys';
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        let inputItem: any = {};

        inputItem.address_n = convertToBip32Path(input.path);
        inputItem.prev_index = input.vout;
        inputItem.prev_hash = input.txId;

        if (input.sequence) inputItem.sequence = input.sequence;

        inputItem.amount = input.value.toString();
        inputItem.script_type = 'SPENDWITNESS';

        trezortx.inputs.push(inputItem);
      }

      for (let i = 0; i < psbt.res.outputs.length; i++) {
        const output = psbt.res.outputs[i];
        let outputItem: any = {};

        outputItem.amount = output.value.toString();

        if (output.script) {
          outputItem.script_type = 'PAYTOOPRETURN';

          const chunks = bjs.script.decompile(output.script);

          if (chunks[0] === bitcoinops.OP_RETURN) {
            outputItem.op_return_data = chunks[1].toString('hex');
          }
        } else {
          outputItem.script_type = 'PAYTOWITNESS';
          outputItem.address = output.address;
        }

        trezortx.outputs.push(outputItem);
      }

      const response = await TrezorConnect.signTransaction(trezortx);

      if (response.success == true) {
        txInfo = await sys.utils.sendRawTransaction(sysjs.blockbookURL, response.payload.serializedTx);

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

  return {
    subscribeAccount,
    getPrimaryAccount,
    updateAccountLabel,
    addNewAccount,
    getLatestUpdate,
    watchMemPool,
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
    confirmNewSPT,
    issueSPT,
    issueNFT,
    confirmIssueSPT,
    confirmIssueNFT,
    getUserMintedTokens,
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