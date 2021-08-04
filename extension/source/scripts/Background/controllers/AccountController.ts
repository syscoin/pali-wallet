/* eslint-disable */
import { sys } from 'constants/index';
import TrezorConnect from 'trezor-connect';
import store from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { bech32 } from 'bech32';
import { fromZPub } from 'bip84';
import {
  createAccount,
  updateStatus,
  updateAccount,
  updateLabel,
  updateTransactions,
  updateAccountAddress,
  updateAccountXpub,
  updateSwitchNetwork,
  updateAllTokens,
} from 'state/wallet';

import {
  IAccountInfo,
  ITransactionInfo,
  Transaction,
  Assets,
  ISPTInfo,
  ISPTIssue,
  INFTIssue,
  ISPTPageInfo,
  ISPTWalletInfo,
  INFTPageInfo,
  INFTWalletInfo,
  ISPTIssuePage,
  ISPTIssueWallet,
  UpdateTokenPageInfo,
  UpdateTokenWalletInfo
} from '../../types';
import axios from 'axios';

const bjs = require('bitcoinjs-lib');
const bitcoinops = require('bitcoin-ops');
const syscointx = require('syscointx-js');
const { each } = require('neo-async');

const AccountController = (actions: {
  checkPassword: (pwd: string) => boolean;
}): IAccountController => {
  let intervalId: any;
  let account: IAccountState;
  let tempTx: ITransactionInfo | null;
  let sysjs: any;
  let newSPT: ISPTInfo | null;
  let mintSPT: ISPTIssue | null;
  let updateAssetItem: any | null;
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
  let currentPSBT: any;

  const getConnectedAccount = (): IAccountState => {
    const { accounts, currentURL }: IWalletState = store.getState().wallet;

    return accounts.find((account: IAccountState) => {
      return account.connectedTo.find((url: string) => {
        return url == new URL(currentURL).host;
      });
    }) as IAccountState;
  };

  const _coventPendingType = (txid: string) => {
    return {
      txid,
      value: 0,
      confirmations: 0,
      fees: 0,
      blockTime: Date.now() / 1e3,
    } as Transaction;
  };

  const updateTransactionData = (item: string, txinfo: any) => {
    const transactionItem = store.getState().wallet[item];
    const transactions = transactionItem ? getConnectedAccount().transactions : account.transactions;

    store.dispatch(
      updateTransactions({
        id: transactionItem ? getConnectedAccount().id : account.id,
        txs: [_coventPendingType(txinfo), ...transactions],
      })
    );
  };

  const getTransactionInfoByTxId = async (txid: any) => {
    return await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);
  };

  const getRawTransaction = async (txid: any) => {
    console.log('data axios', await axios.get(`${sysjs.blockbookURL}/api/v2/tx/${txid}`))
    return await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);
  };

  const getDataAsset = async (assetGuid: any) => {
    return await sys.utils.fetchBackendAsset(sysjs.blockbookURL, assetGuid);
  };

  const getSysExplorerSearch = () => {
    return sysjs.blockbookURL;
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

  const isNFT = (guid: number) => {
    const assetGuid = BigInt.asUintN(64, BigInt(guid));

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
      case 'currentPSBT':
        currentPSBT = null;
        break
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
    }
  }

  const updateTempTx = (tx: ITransactionInfo) => {
    tempTx = { ...tx };
    tempTx.fromAddress = tempTx.fromAddress.trim();
    tempTx.toAddress = tempTx.toAddress.trim();
  };

  const setNewAddress = (addr: string) => {
    const { activeAccountId }: IWalletState = store.getState().wallet;

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
        id,
        xpub,
        xprv
      })
    );

    return true;
  }

  const getPrimaryAccount = (pwd: string, sjs: any) => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;

    if (sjs) {
      sysjs = sjs;
    }

    if (!actions.checkPassword(pwd)) return;

    getLatestUpdate();

    if (!account && accounts) {
      account = accounts.find((account: IAccountState) => account.id === activeAccountId) || accounts[activeAccountId];

      store.dispatch(updateStatus());
    }
  };

  const watchMemPool = (currentAccount: IAccountState) => {
    if (intervalId) {
      return true;
    }

    intervalId = setInterval(() => {
      getLatestUpdate();

      const { accounts }: IWalletState = store.getState().wallet;

      const activeAccount = accounts.find((account: IAccountState) => account.id === currentAccount.id);

      if (
        !activeAccount ||
        !activeAccount?.transactions ||
        !activeAccount!.transactions.filter(
          (tx: Transaction) => tx.confirmations > 0
        ).length
      ) {
        clearInterval(intervalId);

        return false;
      }
    }, 30 * 1000);

    return true;
  };

  const getTransactionItem = () => {
    return {
      currentPSBT: currentPSBT || null,
      tempTx: tempTx || null,
      newSPT: newSPT || null,
      mintSPT: mintSPT || null,
      mintNFT: mintNFT || null,
      updateAssetItem: updateAssetItem || null,
      transferOwnershipData: transferOwnershipData || null
    };
  };

  const convertToBip32Path = (address: string) => {
    const addressArray: string[] = address.replace(/'/g, '').split('/');

    addressArray.shift();

    const addressItem: number[] = [];

    for (const index in addressArray) {
      if (Number(index) <= 2 && Number(index) >= 0) {
        addressItem[Number(index)] = Number(addressArray[index]) | 0x80000000;

        return;
      }

      addressItem[Number(index)] = Number(addressArray[index]);
    }

    return addressItem;
  };

  const getTransactionData = async (txid: string) => {
    return await getTransactionInfoByTxId(txid);
  }

  const fetchBackendConnectedAccount = async (connectedAccount: IAccountState) => {
    if (connectedAccount.isTrezorWallet) {
      return await sys.utils.fetchBackendAccount(sysjs.blockbookURL, account.xpub, 'tokens=nonzero&details=txs', true);
    }

    return await sys.utils.fetchBackendAccount(sysjs.blockbookURL, connectedAccount.xpub, 'details=txs&assetMask=non-token-transfers', true, sysjs.Signer);
  };

  const getChangeAddress = async () => {
    const { activeAccountId }: IWalletState = store.getState().wallet;
    const connectedAccount: IAccountState = getConnectedAccount();
    if (!sysjs) {
      //TODO: enhance this error message
      console.log('SYSJS not defined')

      return await 'Error: wallet is locked, ask client to unlock it to get change address';
    }

    if (connectedAccount.isTrezorWallet) {
      //TODO: Implement changeAddress for trezor wallets 
      //only when trezor enable syscoin on mainnet
      console.log('We do not support changeAddress for trezor wallets yet');
      return 'Error: We do not support changeAddress for trezor wallets yet';
    }

    else {
      let changeAddress: string = '';
      console.log('getting new change Address')
      if (connectedAccount.id === activeAccountId) {
        changeAddress = (await sysjs.Signer.getNewChangeAddress())
        console.log(changeAddress)
        return changeAddress;
      }
      else {
        sysjs.Signer.setAccountIndex(connectedAccount.id)
        changeAddress = await sysjs.Signer.getNewChangeAddress();
        sysjs.Signer.setAccountIndex(activeAccountId)
        console.log('from diff acc')
        console.log(changeAddress)
        return changeAddress;
      }
    }
  }

  const sortList = (list: any) => {
    return list.sort((a: any, b: any) => {
      const previous = a.symbol.toLowerCase();
      const next = b.symbol.toLowerCase();

      //@ts-ignore
      return (previous > next) - (previous < next);
    })
  }

  const updateTokensState = async () => {
    if (!sysjs) {
      return;
    }

    const { accounts }: IWalletState = store.getState().wallet;

    return await Promise.all(accounts.map(async (account: IAccountState) => {
      const assetsData: any = {};

      const { tokensAsset } = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, account.xpub, 'tokens=derived&details=txs', true, sysjs.Signer);
      const { transactions } = await fetchBackendConnectedAccount(account);

      let tokensMap: any = {};
      let mintedTokens: any = {};

      if (!tokensAsset) {
        console.log('account has no tokens');

        store.dispatch(updateAllTokens({
          accountId: account.id,
          accountXpub: account.xpub,
          tokens: tokensMap,
          holdings: sortList(Object.values(assetsData)),
          mintedTokens: sortList(Object.values(mintedTokens)),
        }));

        return;
      }

      await new Promise((resolve) => {
        each(tokensAsset, function ({ balance, symbol, assetGuid, decimals, type }: any, done: any) {
          tokensMap[assetGuid] = {
            balance: Number(tokensMap[assetGuid] ? tokensMap[assetGuid].balance : 0) + Number(balance),
            type,
            decimals,
            symbol: symbol ? atob(String(symbol)) : '',
            assetGuid
          };

          console.log('added')

          done();
        }, function () {
          resolve('ok');
        });
      });

      try {
        if (transactions) {
          await new Promise((resolve) => {
            each(transactions, function ({ tokenType, tokenTransfers }: any, done: any) {
              if (tokenType === 'SPTAssetActivate') {
                for (const token of tokenTransfers) {
                  try {
                    getDataAsset(token.token).then((assetData: any) => {
                      mintedTokens[token.token] = {
                        assetGuid: token.token,
                        symbol: token.symbol ? atob(String(token.symbol)) : '',
                        maxSupply: Number(assetData.maxSupply),
                        totalSupply: Number(assetData.totalSupply)
                      }
                    });
                  } catch (error) {
                    console.log('Get data asset error: ');
                    console.log(error);
                  }
                }
              }

              done();
            }, function () {
              resolve('ok');
            });
          })
        }

        await Promise.all(Object.values(tokensMap).map(async (value) => {
          const {
            balance,
            type,
            decimals,
            symbol,
            assetGuid
          }: any = value;

          const assetId = sys.utils.getBaseAssetID(assetGuid);
          const { pubData } = await getDataAsset(assetGuid);

          const assetData = {
            balance,
            type,
            decimals,
            symbol,
            assetGuid,
            baseAssetID: assetId,
            nftAssetID: isNFT(assetGuid) ? sys.utils.createAssetID(assetId, assetGuid) : null,
            description: pubData && pubData.desc ? atob(pubData.desc) : ''
          }

          assetsData[assetData.assetGuid] = assetData;

          return;
        }));

        store.dispatch(updateAllTokens({
          accountId: account.id,
          accountXpub: account.xpub,
          tokens: tokensMap,
          holdings: sortList(Object.values(assetsData)),
          mintedTokens: sortList(Object.values(mintedTokens)),
        }));

        return;
      } catch (error) {
        console.log(error)
      }

      return;
    }));
  }

  const getHoldingsData = async () => {
    const { walletTokens }: IWalletState = store.getState().wallet;

    if (walletTokens) {
      const connectedAccountId = walletTokens.findIndex((accountTokens: any) => {
        return accountTokens.accountId === getConnectedAccount().id;
      });

      if (connectedAccountId > -1) {
        return walletTokens[connectedAccountId].holdings;
      }
    }

    return [];
  };

  const getUserMintedTokens = async () => {
    const { walletTokens }: IWalletState = store.getState().wallet;

    if (walletTokens) {
      const connectedAccountId = walletTokens.findIndex((accountTokens: any) => {
        return accountTokens.accountId === getConnectedAccount().id;
      });

      if (connectedAccountId > -1) {
        return walletTokens[connectedAccountId].mintedTokens;
      }
    }

    return [];
  };

  const getConnectedAccountXpub = () => {
    return getConnectedAccount().xpub;
  }

  const signTransaction = async (psbt: string) => {
    try {
      return await sysjs.signAndSend(sys.utils.bitcoinjs.Psbt.fromBase64(psbt));
    } catch (error) {
      throw new Error(error);
    }
  };

  const confirmSignature = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(currentPSBT, signTransaction).then((response) => {
        resolve(response);

        currentPSBT = null;
      }).catch((error) => {
        reject(error);
      });
    });
  }

  const setCurrentPSBT = (psbt: any) => {
    currentPSBT = psbt;

    return;
  }

  const getNewChangeAddress = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;
    const userAccount: IAccountState = accounts.find((account: IAccountState) => account.id === activeAccountId) as IAccountState;

    let address = '';

    if (userAccount!.isTrezorWallet) {
      const response = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, userAccount.xpub, 'tokens=nonzero&details=txs', true);

      const TrezorAccount = new fromZPub(userAccount.xpub, sysjs.Signer.Signer.pubtypes, sysjs.Signer.Signer.networks);
      let receivingIndex = -1;
      let changeIndex = -1;

      if (response.tokens) {
        response.tokens.forEach((token: any) => {
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

    return null;
  }

  const fetchAccountInfo = async (isHardwareWallet?: boolean, xpub?: any) => {
    let response: any = null;
    let address: any = null;

    if (isHardwareWallet) {
      response = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, xpub, 'tokens=nonzero&details=txs', true);

      const account0: any = new fromZPub(xpub, sysjs.Signer.Signer.pubtypes, sysjs.Signer.Signer.networks);
      let receivingIndex = -1;

      if (response.tokens) {
        response.tokens.forEach((token: any) => {
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
              }
            }
          }
        });
      }

      address = account0.getAddress(receivingIndex + 1);

      return {
        address,
        response
      };
    }

    response = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.Signer.getAccountXpub(), 'tokens=nonzero&details=txs', true, sysjs.Signer);

    return {
      address,
      response
    };
  }

  const getAccountInfo = async (isHardwareWallet?: boolean, xpub?: any): Promise<IAccountInfo> => {
    const { address, response } = await fetchAccountInfo(isHardwareWallet, xpub);

    const balance = response.balance / 1e8;
    const assets: Assets[] = [];
    let transactions: Transaction[] = [];

    if (response.transactions) {
      transactions = response.transactions.map(({
        txid,
        value,
        confirmations,
        fees,
        blockTime,
        tokenType
      }: Transaction
      ) => {
        return <Transaction>
          {
            txid,
            value,
            confirmations,
            fees,
            blockTime,
            tokenType,
          }
      }).slice(0, 10);
    }

    if (response.tokensAsset) {
      const transform = response.tokensAsset.reduce((response: any, {
        type,
        assetGuid,
        symbol,
        balance,
        decimals
      }: any) => {
        response[assetGuid] = <Assets>{
          type,
          assetGuid,
          symbol: symbol ? atob(String(symbol)) : '',
          balance: (response[assetGuid] ? response[assetGuid].balance : 0) + Number(balance),
          decimals,
        };

        return response;
      }, {});

      for (const key in transform) {
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
      transactions
    };
  };

  const subscribeAccount = async (isHardwareWallet = false, sjs?: any, label?: string, walletCreation?: boolean) => {
    if (isHardwareWallet) {
      const { accounts }: IWalletState = store.getState().wallet;
      const trezorID: number = accounts.reduce((trezorID: number, account: IAccountState) => (account.trezorId) ? trezorID = trezorID > account.trezorId ? trezorID : account.trezorId : trezorID, 0);

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
      await sysjs.Signer.createAccount();
    }
    console.log('Checking Sysjs')
    console.log(sysjs)
    const res: IAccountInfo | null = await getAccountInfo();
    console.log('Info done')
    console.log(res)
    console.log(sysjs.Signer)
    console.log(sysjs.Signer.Signer.accountIndex)
    console.log(sysjs.Signer.Signer.accounts[sysjs.Signer.Signer.accountIndex].getAccountPrivateKey())
    console.log(sysjs.Signer.getNewReceivingAddress())
    account = {
      id: sysjs.Signer.Signer.accountIndex === 0 ? 0 : sysjs.Signer.Signer.accountIndex,
      label: label || `Account ${sysjs.Signer.Signer.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.Signer.getAccountXpub(),
      xprv: sysjs.Signer.Signer.accounts[sysjs.Signer.Signer.accountIndex].getAccountPrivateKey(),
      address: { 'main': await sysjs.Signer.getNewReceivingAddress() },
      assets: res.assets,
      connectedTo: [],
      isTrezorWallet: false
    };
    console.log('Account created')
    store.dispatch(createAccount(account));

    return account!.xpub;
  };

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

    if (!accounts.find((account: IAccountState) => account.id === activeAccountId)) {
      return;
    }

    console.log('sysjs', sysjs)

    account = accounts.find((account: IAccountState) => account.id === activeAccountId)!;

    if (!account.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(activeAccountId);

      const accLatestInfo = await getAccountInfo();

      if (!accLatestInfo) return;

      const { balance, transactions, assets } = accLatestInfo;

      store.dispatch(
        updateAccount({
          id: activeAccountId,
          balance,
          transactions,
          assets
        })
      );

      store.dispatch(updateSwitchNetwork(false))

      return;
    }

    const accLatestInfo = await getAccountInfo(true, account.xpub);

    if (!accLatestInfo) return;

    const { balance, transactions, assets } = accLatestInfo;

    store.dispatch(
      updateAccount({
        id: activeAccountId,
        balance,
        transactions,
        assets
      })
    );

    store.dispatch(updateSwitchNetwork(false))
  };

  const isValidSYSAddress = (address: string, network: string) => {
    if (address && typeof address === 'string') {
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
  const setUpdateAsset = (asset: any) => {
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

  const getAssetguidFromTokenTransfers = async (tokenTransfers: any) => {
    let createdAssetguid: string = '';

    for (const token of tokenTransfers) {
      try {
        const assetGuid = token.token;
        const assetData = await getDataAsset(assetGuid);

        console.log('tokenData', assetData.response)

        if (assetData.response && assetData.response.data.error === 'Asset not found' && !assetData.assetGuid) {
          createdAssetguid = assetGuid;
        }
      } catch (error) {
        console.log('error', error)
      }
    }

    return String(createdAssetguid);
  }

  const confirmSPTCreation = async (item: any) => {
    const {
      capabilityflags,
      notarydetails,
      auxfeedetails,
      precision,
      symbol,
      description,
      initialSupply,
      maxsupply,
      fee,
      notaryAddress,
      payoutAddress,
      receiver
    } = item;

    const newMaxSupply = maxsupply * (10 ** precision);

    let _assetOpts = {
      precision,
      symbol,
      description,
      maxsupply: new sys.utils.BN(newMaxSupply),
      updatecapabilityflags: String(capabilityflags),
      notarydetails,
      auxfeedetails,
      notarykeyid: Buffer.from('', 'hex')
    };

    if (notaryAddress) {
      const vNotaryPayment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: notaryAddress,
        network: sysjs.Signer.Signer.network
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
        network: sysjs.Signer.Signer.network
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

    const txOpts = { rbf: true };

    if (getConnectedAccount().isTrezorWallet) {
      throw new Error('Trezor don\'t support burning of coins');
    }

    sysjs.Signer.setAccountIndex(getConnectedAccount().id);

    console.log('sysjs', sysjs, sysjs.Signer)


    const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, receiver, receiver, new sys.utils.BN(fee * 1e8));

    const txInfoNew = pendingTx.extractTransaction().getId();

    updateTransactionData('creatingAsset', txInfoNew);

    const transactionData = await getTransactionInfoByTxId(txInfoNew);
    const assets = syscointx.getAssetsFromTx(pendingTx.extractTransaction());
    const createdAsset = assets.keys().next().value;

    if (initialSupply && initialSupply < newMaxSupply) {
      try {
        return new Promise(async (resolve: any, reject: any) => {
          let interval: any;

          interval = setInterval(async () => {
            const sptCreated = await getTransactionInfoByTxId(txInfoNew);

            if (sptCreated?.confirmations > 1) {
              console.log('confirmations > 1', createdAsset)

              try {
                const assetMap = new Map([
                  [String(createdAsset), {
                    changeAddress: null,
                    outputs: [{
                      value: new sys.utils.BN(initialSupply * (10 ** precision)),
                      address: null
                    }]
                  }]
                ]);

                const pendingTx = await sysjs.assetSend(txOpts, assetMap, receiver, new sys.utils.BN(fee * 1e8));

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?');
                }

                const txInfo = pendingTx.extractTransaction().getId();

                updateTransactionData('issuingSPT', txInfo);

                watchMemPool(getConnectedAccount());

                clearInterval(interval);

                resolve({
                  sptCreated,
                  txid: txInfo,
                  txConfirmations: sptCreated.confirmations,
                  txAssetGuid: createdAsset,
                  psbt: pendingTx.toBase64()
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
      txid: txInfoNew,
      txConfirmations: transactionData.confirmations,
      txAssetGuid: createdAsset,
      psbt: pendingTx.toBase64()
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
      assetGuid,
      amount
    } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };
    const assetChangeAddress = null;

    let txInfo;

    const { decimals } = await getDataAsset(assetGuid);

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: assetChangeAddress,
        outputs: [{
          value: new sys.utils.BN(amount * (10 ** decimals)),
          address: assetChangeAddress
        }]
      }]
    ]);

    sysjs.Signer.setAccountIndex(getConnectedAccount().id);

    let sysChangeAddress = null;

    if (getConnectedAccount().isTrezorWallet) {
      sysChangeAddress = await getNewChangeAddress();
      // @ts-ignore: Unreachable code error
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const psbt = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate, account.xpub);

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      const trezortx: any = {};

      trezortx.coin = 'sys';
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        const inputItem: any = {};

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
        const outputItem: any = {};

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

    watchMemPool(getConnectedAccount());

    return {
      txid: txInfo
    }
  };

  const confirmIssueSPT = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(mintSPT, confirmMintSPT).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error);
      });

      mintSPT = null;
    });
  };

  const createParentAsset = async (assetOpts: any, fee: number) => {
    const txOpts: any = { rbf: true };
    const feeRate = new sys.utils.BN(fee * 1e8);

    sysjs.Signer.setAccountIndex(getConnectedAccount().id);

    let assetChangeAddress = await sysjs.Signer.getNewChangeAddress();

    console.log('sysjs', sysjs, sysjs.Signer)

    const psbt = await sysjs.assetNew(assetOpts, txOpts, assetChangeAddress, assetChangeAddress, feeRate);

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
      symbol,
      description,
      issuer,
      precision,
    } = item;

    if (getConnectedAccount().isTrezorWallet) {
      throw new Error('trezor does not support nft creation');
    }

    const assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(1 * (10 ** precision)),
      description,
    }

    const newParentAsset = await createParentAsset(assetOpts, fee);

    if (newParentAsset?.asset_guid) {
      let theNFTTx: any = null;
      let parentConfirmed = false;
      let txInfo: any = null;

      try {
        return new Promise((resolve) => {
          let interval: any;

          interval = setInterval(async () => {
            const newParentTx = await getTransactionInfoByTxId(newParentAsset.txid);
            const feeRate = new sys.utils.BN(fee * 1e8);
            const txOpts = { rbf: true };

            if (newParentTx.confirmations > 1 && !parentConfirmed) {
              parentConfirmed = true;

              const assetMap = new Map([
                [newParentAsset!.asset_guid,
                {
                  changeAddress: null,
                  outputs: [{
                    value: new sys.utils.BN(1 * (10 ** precision)),
                    address: issuer
                  }]
                }]
              ]);

              try {
                sysjs.Signer.setAccountIndex(getConnectedAccount().id);

                console.log('sysjs', sysjs, sysjs.Signer)

                const pendingTx = await sysjs.assetSend(txOpts, assetMap, issuer, feeRate);

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?')
                }

                txInfo = pendingTx.extractTransaction().getId();

                updateTransactionData('issuingNFT', txInfo);

                theNFTTx = txInfo;
              } catch (error) {
                console.log('error creating nft', error);

                parentConfirmed = false;

                return error;
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
                const txOpts = { rbf: true };
                const assetGuid = newParentAsset!.asset_guid;
                const assetOpts = { updatecapabilityflags: '0' };

                sysjs.Signer.setAccountIndex(getConnectedAccount().id);

                let assetChangeAddress = null;

                console.log('sysjs', sysjs, sysjs.Signer)

                const assetMap = new Map([
                  [assetGuid, {
                    changeAddress: assetChangeAddress,
                    outputs: [{
                      value: new sys.utils.BN(0),
                      address: assetChangeAddress
                    }]
                  }]
                ]);

                const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, issuer, feeRate);

                if (!psbt) {
                  console.log('Could not create transaction, not enough funds?')
                }

                clearInterval(interval);

                resolve({
                  txid: psbt.extractTransaction().getId()
                });
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
    return new Promise((resolve, reject) => {
      handleTransactions(mintNFT, confirmMintNFT).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error);
      });

      mintNFT = null;
    });
  };

  const confirmTransactionTx = async (
    items: {
      amount: number,
      fee: number,
      fromAddress: string,
      isToken: boolean,
      rbf: boolean,
      toAddress: string,
      token: any
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

    sysjs.Signer.setAccountIndex(store.getState().wallet.activeAccountId);

    if (isToken && token) {
      let txInfo;

      const txOpts = { rbf };
      const value = new sys.utils.BN(amount * 10 ** token.decimals);

      const assetMap = new Map([
        [token.assetGuid, {
          changeAddress: null,
          outputs: [{
            value,
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

        const trezortx: any = {};

        trezortx.coin = 'sys';
        trezortx.version = psbt.res.txVersion;
        trezortx.inputs = [];
        trezortx.outputs = [];

        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i];
          const inputItem: any = {};

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
          const outputItem: any = {};

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

        const trezortx: any = {};

        trezortx.coin = 'sys';
        trezortx.version = psbt.res.txVersion;
        trezortx.inputs = [];
        trezortx.outputs = [];

        for (let i = 0; i < psbt.res.inputs.length; i++) {
          const input = psbt.res.inputs[i];
          const inputItem: any = {};

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
          const outputItem: any = {};

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

    const acc = store.getState().wallet.confirmingTransaction ? getConnectedAccount() : account;

    watchMemPool(acc);
  }

  const confirmTempTx = () => {
    return new Promise((resolve) => {
      resolve(handleTransactions(tempTx, confirmTransactionTx));
    });
  };

  const setHDSigner = (accountId: number) => {
    sysjs.Signer.setAccountIndex(accountId);
  }

  const confirmUpdateAsset = async (item: any) => {
    const {
      fee,
      assetGuid,
      assetWhiteList,
      capabilityflags,
      contract,
      description,
      notarydetails,
      auxfeedetails,
      notaryAddress,
      payoutAddress
    } = item;

    let txOpts: any = {
      rbf: true
    };

    let assetOpts: any = {
      updatecapabilityflags: String(capabilityflags),
      description
    };

    if (assetWhiteList) {
      txOpts = {
        ...txOpts,
        assetWhiteList,
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
        network: sysjs.Signer.Signer.network
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
        network: sysjs.Signer.Signer.network
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

    sysjs.Signer.setAccountIndex(getConnectedAccount().id);

    // let changeAddress = await sysjs.Signer.getNewChangeAddress();

    console.log('sysjs', sysjs, sysjs.Signer)

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, thisAssetMap, null, new sys.utils.BN(fee * 1e8));

    const txInfo = pendingTx.extractTransaction().getId();

    if (!pendingTx || !txInfo) {
      console.log('Could not create transaction, not enough funds?');
    }

    updateTransactionData('updatingAsset', txInfo);

    watchMemPool(getConnectedAccount());

    return {
      txid: txInfo
    }
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
      assetGuid,
      newOwner
    } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };
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

    if (getConnectedAccount().isTrezorWallet) {
      const sysChangeAddress = await getNewChangeAddress();

      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

      if (!psbt) {
        console.log('Could not create transaction, not enough funds?')
      }

      const trezortx: any = {};

      trezortx.coin = 'sys';
      trezortx.version = psbt.res.txVersion;
      trezortx.inputs = [];
      trezortx.outputs = [];

      for (let i = 0; i < psbt.res.inputs.length; i++) {
        const input = psbt.res.inputs[i];
        const inputItem: any = {};

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
        const outputItem: any = {};

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

        watchMemPool(getConnectedAccount());
      }

      return;
    }

    sysjs.Signer.setAccountIndex(getConnectedAccount().id);

    // let assetChangeAddress = await sysjs.Signer.getNewChangeAddress();

    console.log('sysjs', sysjs, sysjs.Signer)

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, newOwner, feeRate);

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?');
    }

    txInfo = pendingTx.extractTransaction().getId();

    updateTransactionData('transferringOwnership', txInfo);

    watchMemPool(getConnectedAccount());

    return {
      txid: txInfo
    }
  }

  const confirmTransferOwnership = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(transferOwnershipData, transferAsset).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error)
      });

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
    clearTransactionItem,
    confirmSignature,
    getConnectedAccount,
    getConnectedAccountXpub,
    getChangeAddress,
    setCurrentPSBT,
    updateTokensState,
    getTransactionData,
    getRawTransaction,
    setHDSigner,
    getAssetguidFromTokenTransfers
  };
};

export default AccountController;