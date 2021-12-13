/* eslint-disable */
import { sys } from 'constants/index';
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
  setTimer
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
import CryptoJS from 'crypto-js';
// import axios from 'axios';

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
  let dataFromPageToIssueNFT: any;
  let dataFromWalletToIssueNFT: any;
  let resAddress: any;
  let encode: any;
  let currentPSBT: any;
  let TrezorSigner: any;
  let currentPsbtToSign: any;
  let issueNFTItem: any | null;

  const getConnectedAccount = (): IAccountState => {
    const { accounts, tabs }: IWalletState = store.getState().wallet;
    const { currentURL } = tabs;

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
    return await sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);
  };

  const getDataAsset = async (assetGuid: any) => {
    return await sys.utils.fetchBackendAsset(sysjs.blockbookURL, assetGuid);
  };

  const countDecimals = (x: number) => {
    if (Math.floor(x) === x) return 0;
    return x.toString().split(".")[1].length || 0;
  }

  const getSysExplorerSearch = () => {
    return sysjs.blockbookURL;
  };

  const updateAccountLabel = (id: number, label: string, isHardwareWallet?: boolean) => {
    if (isHardwareWallet) {
      return;
    }

    store.dispatch(updateLabel({ id, label }));
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
      case 'issueNFTItem':
        issueNFTItem = null;
        break;
      case 'currentPSBT':
        currentPSBT = null;
        break
      case 'currentPsbtToSign':
        currentPsbtToSign = null;
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

  const setNewXpub = (id: number, xpub: string, xprv: string, key: string) => {
    store.dispatch(
      updateAccountXpub({
        id,
        xpub,
        xprv: CryptoJS.AES.encrypt(xprv, String(key)).toString()
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
      issueNFTItem: issueNFTItem || null,
      currentPSBT: currentPSBT || null,
      currentPsbtToSign: currentPsbtToSign || null,
      tempTx: tempTx || null,
      newSPT: newSPT || null,
      mintSPT: mintSPT || null,
      mintNFT: mintNFT || null,
      updateAssetItem: updateAssetItem || null,
      transferOwnershipData: transferOwnershipData || null
    };
  };

  const getTransactionData = async (txid: string) => {
    return await getTransactionInfoByTxId(txid);
  }

  const fetchBackendConnectedAccount = async (connectedAccount: IAccountState) => {
    if (connectedAccount.isTrezorWallet) {
      return await sys.utils.fetchBackendAccount(sysjs.blockbookURL, account.xpub, 'tokens=nonzero&details=txs', true);
    }

    return await sys.utils.fetchBackendAccount(sysjs.blockbookURL, connectedAccount.xpub, 'details=txs&assetMask=non-token-transfers', true);
  };

  const getChangeAddress = async () => {
    const connectedAccount: IAccountState = getConnectedAccount();
    if (!sysjs) {
      console.log('SYSJS not defined');

      return await 'Error: wallet is locked, ask client to unlock it to get change address';
    }

    if (connectedAccount.isTrezorWallet) {
      let addr: string = 'Error: Failed to fetch trezor change address';

      const inter = await getNewChangeAddress(true);

      if (inter !== null) {
        addr = inter
      }

      return addr;
    }

    return await sysjs.Signer.getNewChangeAddress(true);
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

      const { tokensAsset } = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, account.xpub, 'tokens=derived&details=txs', true);
      const { transactions } = await fetchBackendConnectedAccount(account);

      let tokensMap: any = {};
      let mintedTokens: any = {};

      if (!tokensAsset) {
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
          try {
            const {
              balance,
              type,
              decimals,
              symbol,
              assetGuid
            }: any = value;

            const { pubData } = await getDataAsset(assetGuid);

            const { baseAssetID, NFTID } = sys.utils.getAssetIDs(assetGuid);

            const assetData = {
              balance,
              type,
              decimals,
              symbol,
              assetGuid,
              baseAssetID,
              childAssetID: isNFT(assetGuid) ? sys.utils.createAssetID(NFTID, assetGuid) : null,
              NFTID,
              description: pubData && pubData.desc ? atob(pubData.desc) : ''
            }

            assetsData[assetData.assetGuid] = assetData;

            return;
          } catch (error) {
            console.log('error minted tokens', error)
          }
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

    if (getConnectedAccount() === undefined) {
      return null;
    }
    else {
      return getConnectedAccount().xpub;
    }
  }

  const signTransaction = async (jsonData: any, sendPSBT: boolean) => {
    const base64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

    if (!base64.test(jsonData.psbt) || typeof jsonData.assets !== 'string') {
      throw new Error(`PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.`);
    }

    try {
      const response = sys.utils.importPsbtFromJson(jsonData);

      if (!TrezorSigner) {
        TrezorSigner = new sys.utils.TrezorSigner();

        new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
      }

      if (sendPSBT) {
        if (getConnectedAccount().isTrezorWallet) {
          return sys.utils.exportPsbtToJson(await TrezorSigner.sign(response.psbt));
        }

        return sys.utils.exportPsbtToJson(await sysjs.Signer.sign(response.psbt));
      }

      if (getConnectedAccount().isTrezorWallet) {
        return sys.utils.exportPsbtToJson(await sysjs.signAndSend(response.psbt, response.assets, TrezorSigner));
      }

      return sys.utils.exportPsbtToJson(await sysjs.signAndSend(response.psbt, response.assets));
    } catch (error) {
      throw new Error(String(error));
    }
  };

  const importPsbt = (psbt: any) => {
    try {
      return sys.utils.importPsbtFromJson(psbt);
    } catch (error) {
      return psbt;
    }
  }

  const confirmSignature = (sendPSBT: boolean) => {
    return new Promise((resolve, reject) => {
      const item = sendPSBT ? currentPsbtToSign : currentPSBT;
      handleTransactions(item, signTransaction, sendPSBT).then((response) => {
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

  const setCurrentPsbtToSign = (psbtToSign: any) => {
    currentPsbtToSign = psbtToSign;

    return;
  }

  const getNewChangeAddress = async (fromConnectionsController: boolean) => {
    let userAccount: IAccountState;
    if (fromConnectionsController) {
      userAccount = getConnectedAccount();
    }
    else {
      const { activeAccountId, accounts }: IWalletState = store.getState().wallet;
      userAccount = accounts.find((account: IAccountState) => account.id === activeAccountId) as IAccountState;

    }
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

    response = await sys.utils.fetchBackendAccount(sysjs.blockbookURL, sysjs.Signer.getAccountXpub(), 'tokens=nonzero&details=txs', true);

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
      console.log('response transactions', response.transactions)
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
      }).slice(0, 20);
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

  const subscribeAccount = async (encriptedPassword: any, isHardwareWallet = false, sjs?: any, label?: string, walletCreation?: boolean) => {
    if (isHardwareWallet) {
      if (TrezorSigner === null || TrezorSigner === undefined) {
        TrezorSigner = sjs
        new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
      }
      const { accounts }: IWalletState = store.getState().wallet;
      const trezorID: number = accounts.reduce((trezorID: number, account: IAccountState) => (account.trezorId) ? trezorID = trezorID > account.trezorId ? trezorID : account.trezorId : trezorID, 0);

      const trezorinfo: IAccountInfo | null = await getAccountInfo(isHardwareWallet, sjs.getAccountXpub());

      if (trezorinfo.address) {
        account = {
          id: 9999 + trezorID,
          label: `Trezor ${trezorID + 1}`,
          balance: trezorinfo.balance / (10 ** 8),
          transactions: trezorinfo.transactions,
          xpub: sjs.getAccountXpub(),
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

    const res: IAccountInfo | null = await getAccountInfo();

    let mainAddress = '';

    try {
      mainAddress = await sysjs.Signer.getNewReceivingAddress(true);

      console.log('sysjs signer', sysjs.Signer.Signer.blockbookURL)
      console.log('sysjs signer', sysjs.Signer)

      console.log('main address get new receiving address', mainAddress)
    } catch (error: any) {
      console.log('error getting receiving address from sys', error)

      throw new Error(error);
    }

    account = {
      id: sysjs.Signer.Signer.accountIndex === 0 ? 0 : sysjs.Signer.Signer.accountIndex,
      label: label || `Account ${sysjs.Signer.Signer.accountIndex + 1}`,
      balance: res.balance,
      transactions: res.transactions,
      xpub: sysjs.Signer.getAccountXpub(),
      xprv: CryptoJS.AES.encrypt(sysjs.Signer.Signer.accounts[sysjs.Signer.Signer.accountIndex].getAccountPrivateKey(), encriptedPassword).toString(),
      address: { 'main': mainAddress },
      assets: res.assets,
      connectedTo: [],
      isTrezorWallet: false
    };

    store.dispatch(createAccount(account));

    return account!.xpub;
  };

  const getLatestUpdate = async () => {
    const { activeAccountId, accounts }: IWalletState = store.getState().wallet;

    if (!accounts.find((account: IAccountState) => account.id === activeAccountId)) {
      return;
    }

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

  const isValidSYSAddress = (address: string, network: string, verification: boolean = true) => {
    if (!verification) {
      return true;
    }

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
      dataFromPageToIssueNFT: dataFromPageToIssueNFT || null,
      dataFromWalletToIssueNFT: dataFromWalletToIssueNFT || null,
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

  const setDataFromPageToIssueNFT = (data: any) => {
    dataFromPageToIssueNFT = data;
  }

  const setDataFromWalletToIssueNFT = (data: any) => {
    dataFromWalletToIssueNFT = data;
  }

  const setDataFromPageToCreateNewSPT = (data: ISPTPageInfo) => {
    dataFromPageToCreateSPT = data;
  }

  const setDataFromWalletToCreateSPT = (data: ISPTWalletInfo) => {
    dataFromWalletToCreateSPT = data;
  }

  const setDataFromPageToMintSPT = (data: ISPTIssuePage) => {
    dataFromPageToMintSPT = data;
  }

  const setDataFromWalletToMintSPT = (data: ISPTIssueWallet) => {
    dataFromWalletToMintSPT = data;
  }

  const setDataFromPageToMintNFT = (data: INFTPageInfo) => {
    dataFromPageToMintNFT = data;
  }

  const setDataFromWalletToMintNFT = (data: INFTWalletInfo) => {
    dataFromWalletToMintNFT = data;
  }

  const setDataFromPageToUpdateAsset = (data: UpdateTokenPageInfo) => {
    dataFromPageToUpdateAsset = data;
  }

  const setDataFromWalletToUpdateAsset = (data: UpdateTokenWalletInfo) => {
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

    return true;
  }

  const setNewIssueNFT = (nft: any) => {
    issueNFTItem = nft;

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
  const setUpdateAsset = (asset: any) => {
    updateAssetItem = asset;

    return true;
  }

  const setNewOwnership = (asset: any) => {
    transferOwnershipData = asset;

    return true;
  }

  const handleTransactions = async (item: any, executeTransaction: any, condition?: boolean) => {
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
      executeTransaction(item, condition)
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
      updatecapabilityflags: capabilityflags ? String(capabilityflags) : '127',
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

    const pendingTx = await sysjs.assetNew(_assetOpts, txOpts, await sysjs.Signer.getNewChangeAddress(true), receiver, new sys.utils.BN(fee * 1e8));

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
              const changeaddress = await sysjs.Signer.getNewChangeAddress(true);

              try {
                const assetMap = new Map([
                  [String(createdAsset), {
                    changeAddress: changeaddress,
                    outputs: [{
                      value: new sys.utils.BN(initialSupply * (10 ** precision)),
                      address: receiver
                    }]
                  }]
                ]);

                const pendingTx = await sysjs.assetSend(txOpts, assetMap, receiver, new sys.utils.BN(fee * 1e8));

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?');

                  return;
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

    let txInfo;

    if (!getConnectedAccount().isTrezorWallet) {
      sysjs.Signer.setAccountIndex(getConnectedAccount().id);
    }

    const { decimals } = await getDataAsset(assetGuid);
    const receivingAddress = await sysjs.Signer.getNewReceivingAddress(true);

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: null,
        outputs: [{
          value: new sys.utils.BN(amount * (10 ** decimals)),
          address: receivingAddress
        }]
      }]
    ]);

    let sysChangeAddress: any = null;

    if (getConnectedAccount().isTrezorWallet) {
      sysChangeAddress = await getNewChangeAddress(true);

      // @ts-ignore
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const txData = await sysjs.assetSend(txOpts, assetMap, sysChangeAddress, feeRate, account.xpub);

      if (!txData) {
        console.log('Could not create transaction, not enough funds?')
        
        return;
      }

      if (TrezorSigner === null || TrezorSigner === undefined) {
        TrezorSigner = new sys.utils.TrezorSigner();

        new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
      }

      try {
        let waitTrezor = true;

        sysjs.signAndSend(txData.psbt, txData.assets, TrezorSigner).then((txInfo: string) => {
          updateTransactionData('issuingSPT', txInfo);

          watchMemPool(getConnectedAccount());

          waitTrezor = false;

          return {
            txid: txInfo
          }
        });

        if (waitTrezor) { }

        return
      } catch (error) {
        console.log(`error processing tx: ${error}`);

        return;
      }
    } else {
      const pendingTx = await sysjs.assetSend(txOpts, assetMap, await sysjs.Signer.getNewChangeAddress(true), feeRate);

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?');

        return;
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

    if (!getConnectedAccount().isTrezorWallet) {
      sysjs.Signer.setAccountIndex(getConnectedAccount().id);
    }

    let assetChangeAddress = await sysjs.Signer.getNewChangeAddress(true);

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

    if (!getConnectedAccount().isTrezorWallet) {
      sysjs.Signer.setAccountIndex(getConnectedAccount().id);
    }

    const assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(1 * (10 ** precision)),
      description,
    }

    const newParentAsset = await createParentAsset(assetOpts, fee);

    console.log('current parent asset', newParentAsset);

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

              console.log('confirmations parent tx > 1', newParentAsset)

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
                const pendingTx = await sysjs.assetSend(txOpts, assetMap, null, feeRate);

                if (!pendingTx) {
                  console.log('Could not create transaction, not enough funds?')

                  return;
                }

                txInfo = pendingTx.extractTransaction().getId();

                updateTransactionData('issuingNFT', txInfo);

                theNFTTx = txInfo;
              } catch (error) {
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

                const assetMap = new Map([
                  [assetGuid, {
                    changeAddress: null,
                    outputs: [{
                      value: new sys.utils.BN(0),
                      address: issuer
                    }]
                  }]
                ]);

                const psbt = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, issuer, feeRate);

                console.log('after update psbt', psbt)

                if (!psbt) {
                  console.log('Could not create transaction, not enough funds?');
                }

                clearInterval(interval);

                resolve({
                  txid: psbt.extractTransaction().getId()
                });
              }

              return;
            }
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

  const confirmTxIssueNFT = async (item: any) => {
    const {
      fee,
      amount,
      assetGuid,
    }: any = item;

    const { decimals } = await getDataAsset(assetGuid);
    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };

    const assetMap = new Map([
      [assetGuid,
        {
          changeAddress: await sysjs.Signer.getNewChangeAddress(true),
          outputs: [{
            value: new sys.utils.BN(amount * (10 ** decimals)),
            address: await sysjs.Signer.getNewReceivingAddress(true)
          }]
        }]
    ]);

    try {
      if (!getConnectedAccount().isTrezorWallet) {
        sysjs.Signer.setAccountIndex(getConnectedAccount().id);
      }

      const pendingTx = await sysjs.assetSend(txOpts, assetMap, await sysjs.Signer.getNewChangeAddress(true), feeRate);

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?')
      }

      const txInfo = pendingTx.extractTransaction().getId();

      updateTransactionData('issuingNFT', txInfo);

      return {
        txid: txInfo
      }
    } catch (error) {
      return error;
    }
  }

  const confirmIssueNFTTx = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(issueNFTItem, confirmTxIssueNFT).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error);
      });

      issueNFTItem = null;
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
      token: string
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
      const { decimals } = await getDataAsset(token);
      const txOpts = { rbf };
      const value = new sys.utils.BN(amount * 10 ** decimals);
      const valueDecimals = countDecimals(amount);
      if (valueDecimals > decimals) {
        throw new Error('This token has ' + decimals + ' decimals and you are trying to send a value with ' + valueDecimals + ' decimals, please check your tx')
      }

      const assetMap = new Map([
        [token, {
          changeAddress: null,
          outputs: [{
            value,
            address: toAddress
          }]
        }]
      ]);

      if (account.isTrezorWallet) {
        const changeAddress = await getNewChangeAddress(false);
        // @ts-ignore: Unreachable code error
        assetMap.get(token)!.changeAddress = changeAddress;

        const txData = await sysjs.assetAllocationSend(txOpts, assetMap, changeAddress, new sys.utils.BN(fee * 1e8), account.xpub);

        if (!txData) {
          console.log('Could not create transaction, not enough funds?')
        }
        if (TrezorSigner === null || TrezorSigner === undefined) {
          TrezorSigner = new sys.utils.TrezorSigner();
          new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
        }
        try {
          // TrezorSigner.sign(txData.psbt).then(() => {

          sysjs.signAndSend(txData.psbt, txData.assets, TrezorSigner).then(() => {
            const acc = store.getState().wallet.confirmingTransaction ? getConnectedAccount() : account;
            watchMemPool(acc);
          })
          tempTx = null;
          return
        }
        catch (e) {
          return;
        }
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

      const changeAddress = await sysjs.Signer.getNewChangeAddress(true);

      if (account.isTrezorWallet) {
        const txData = await sysjs.createTransaction(txOpts, await getNewChangeAddress(false), outputsArray, new sys.utils.BN(fee * 1e8), account.xpub);

        if (!txData) {
          console.log('Could not create transaction, not enough funds?')
        }

        if (TrezorSigner === null || TrezorSigner === undefined) {
          TrezorSigner = new sys.utils.TrezorSigner();
          new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
        }

        try {
          sysjs.signAndSend(txData.psbt, txData.assets, TrezorSigner).then(() => {
            const acc = store.getState().wallet.confirmingTransaction ? getConnectedAccount() : account;

            watchMemPool(acc);
          })
          tempTx = null;

          return
        }

        catch (e) {
          console.log('Error processing tx: ' + e)
          return;
        }

      } else {
        try {
          const pendingTx = await sysjs.createTransaction(txOpts, changeAddress, outputsArray, new sys.utils.BN(fee * 1e8));

          txInfo = pendingTx.extractTransaction().getId();
        } catch (error) {
          throw new Error(String(error));
        }
      }

      updateTransactionData('confirmingTransaction', txInfo);
    }

    tempTx = null;

    const acc = store.getState().wallet.confirmingTransaction ? getConnectedAccount() : account;

    watchMemPool(acc);
  }

  const confirmTempTx = () => {
    return new Promise((resolve, reject) => {
      handleTransactions(tempTx, confirmTransactionTx).then((response) => {
        resolve(response);
      }).catch((error) => {
        reject(error);
      });;
    });
  };

  const setHDSigner = (accountId: number) => {
    if (!account.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(accountId);
    }
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
      updatecapabilityflags: capabilityflags ? String(capabilityflags) : '127',
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
        changeAddress: await sysjs.Signer.getNewChangeAddress(true),
        outputs: [{
          value: new sys.utils.BN(0),
          address: await sysjs.Signer.getNewReceivingAddress(true)
        }]
      }]
    ]);


    if (!getConnectedAccount().isTrezorWallet) {
      sysjs.Signer.setAccountIndex(getConnectedAccount().id);
    }

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, thisAssetMap, null, new sys.utils.BN(fee * 1e8));

    const txInfo = pendingTx.extractTransaction().getId();

    if (!pendingTx || !txInfo) {
      console.log('Could not create transaction, not enough funds?');

      return;
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
        resolve(response)

        updateAssetItem = null;
      }).catch((error) => {
        reject(error)

        updateAssetItem = null;
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

    if (!getConnectedAccount().isTrezorWallet) {
      sysjs.Signer.setAccountIndex(getConnectedAccount().id);
    }

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };
    const assetOpts = {};

    let txInfo = null;

    const assetMap = new Map([
      [assetGuid, {
        changeAddress: await sysjs.Signer.getNewChangeAddress(true),
        outputs: [{
          value: new sys.utils.BN(0),
          address: newOwner
        }]
      }]
    ]);

    if (getConnectedAccount().isTrezorWallet) {
      const sysChangeAddress = await getNewChangeAddress(true);

      // @ts-ignore
      assetMap.get(assetGuid)!.changeAddress = sysChangeAddress;

      const txData = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate);

      if (!txData) {
        console.log('Could not create transaction, not enough funds?')
      }
      if (TrezorSigner === null || TrezorSigner === undefined) {
        TrezorSigner = new sys.utils.TrezorSigner();
        new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
      }
      try {
        //TODO: test might have same problem as them mintSPT
        txInfo = await sysjs.signAndSend(txData.psbt, txData.assets, TrezorSigner)

        updateTransactionData('transferringOwnership', txInfo);

        watchMemPool(getConnectedAccount());
      }
      catch (e) {
        console.log('Error processing tx: ' + e)
        return;
      }
      return;
    }

    const pendingTx = await sysjs.assetUpdate(assetGuid, assetOpts, txOpts, assetMap, null, feeRate);

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

  const decryptAES = (encryptedString: any, key: string) => {
    return CryptoJS.AES.decrypt(encryptedString, key).toString(CryptoJS.enc.Utf8);
  }

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  }

  return {
    subscribeAccount,
    getPrimaryAccount,
    updateAccountLabel,
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
    setCurrentPsbtToSign,
    updateTokensState,
    getTransactionData,
    getRawTransaction,
    setHDSigner,
    confirmIssueNFTTx,
    setNewIssueNFT,
    setDataFromPageToIssueNFT,
    setDataFromWalletToIssueNFT,
    importPsbt,
    decryptAES,
    setAutolockTimer,
  };
};

export default AccountController;