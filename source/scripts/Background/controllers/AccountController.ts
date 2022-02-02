import store from 'state/store';
import IWalletState, {
  IAccountState,
  IMintedToken,
  INetwork,
} from 'state/wallet/types';
import { bech32 } from 'bech32';
import { fromZPub } from 'bip84';
import CryptoJS from 'crypto-js';
import {
  Assets,
  IAccountInfo,
  MintAsset,
  SendAsset,
  TemporaryTransaction,
  Transaction,
  TransferAsset,
} from 'types/transactions';
import { IAccountController } from 'types/controllers';
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
  setTimer,
  updateNetwork,
  setTemporaryTransactionState,
} from 'state/wallet';

import { sortList, isNFT, countDecimals } from './utils';

const syscointx = require('syscointx-js');
const coinSelectSyscoin = require('coinselectsyscoin');
const { each } = require('neo-async');
const sys = require('syscoinjs-lib');

const AccountController = (actions: {
  checkPassword: (pwd: string) => boolean;
}): IAccountController => {
  let intervalId: any;
  let globalAccount: IAccountState | undefined;
  let sysjs: any;
  let TrezorSigner: any;

  const temporaryTransaction: TemporaryTransaction = {
    newAsset: null,
    mintAsset: null,
    newNFT: null,
    updateAsset: null,
    transferAsset: null,
    sendAsset: null,
    signPSBT: null,
    signAndSendPSBT: null,
    mintNFT: null,
  };

  const decryptAES = (encryptedString: any, key: string) =>
    CryptoJS.AES.decrypt(encryptedString, key).toString(CryptoJS.enc.Utf8);

  const setAutolockTimer = (minutes: number) => {
    store.dispatch(setTimer(minutes));
  };

  const updateNetworkData = (network: INetwork) => {
    store.dispatch(updateNetwork(network));
  };

  //* ----- TemporaryTransaction -----
  const getTemporaryTransaction = (type: string) => temporaryTransaction[type];

  const clearTemporaryTransaction = (item: string) => {
    temporaryTransaction[item] = null;
  };

  const updateTemporaryTransaction = ({ tx, type }) => {
    temporaryTransaction[type] = { ...tx };
  };
  //* end

  const setTrezorSigner = () => {
    TrezorSigner = new sys.utils.TrezorSigner();
    new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
  };

  const setHDSigner = (accountId: number) => {
    if (!globalAccount?.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(accountId);
    }
  };

  const getActiveAccount = (): IAccountState | undefined => {
    const { accounts, activeAccountId }: IWalletState = store.getState().wallet;

    return accounts.find(
      (account: IAccountState) => account.id === activeAccountId
    );
  };

  const getConnectedAccount = (): IAccountState => {
    const { accounts, tabs }: IWalletState = store.getState().wallet;
    const { currentURL } = tabs;

    return accounts.find((account: IAccountState) =>
      account.connectedTo.find(
        (url: string) => url === new URL(currentURL).host
      )
    ) as IAccountState;
  };

  const connectedAccountXpub = getConnectedAccount()
    ? getConnectedAccount().xpub
    : null;

  const createEmptyTransaction = (txid: string): Transaction => ({
    txid,
    value: 0,
    confirmations: 0,
    fees: 0,
    blockTime: Date.now() / 1e3,
    tokenType: '',
  });

  const updateTransactionData = (txinfo: any) => {
    const { temporaryTransactionState } = store.getState().wallet;
    const isSendAsset = temporaryTransactionState.type === 'sendAsset';

    let transactions: Transaction[] = [];

    if (isSendAsset && globalAccount) {
      transactions = globalAccount.transactions;
    }

    const connectedAccount = getConnectedAccount();

    if (!isSendAsset && connectedAccount)
      transactions = connectedAccount.transactions;

    store.dispatch(
      updateTransactions({
        id: isSendAsset
          ? Number(globalAccount?.id)
          : Number(getConnectedAccount().id),
        txs: [createEmptyTransaction(txinfo), ...transactions],
      })
    );
  };

  const getTransaction = (txid): Promise<Transaction> =>
    sys.utils.fetchBackendRawTx(sysjs.blockbookURL, txid);

  const getAsset = async (
    assetGuid: any
  ): Promise<{
    assetGuid: string;
    contract: string;
    decimals: number;
    maxSupply: string;
    pubData: any;
    symbol: string;
    totalSupply: string;
    updateCapabilityFlags: number;
  }> => sys.utils.fetchBackendAsset(sysjs.blockbookURL, assetGuid);

  const getBlockbookURL = () => sysjs.blockbookURL;

  const updateAccountLabel = (
    id: number,
    label: string,
    isHardwareWallet = false
  ) => {
    if (isHardwareWallet) return;

    store.dispatch(updateLabel({ id, label }));
  };

  const getRecommendFee = async () =>
    (await sys.utils.fetchEstimateFee(sysjs.blockbookURL, 1)) / 10 ** 8;

  const fetchAccountInfo = async (isHardwareWallet?: boolean, xpub?: any) => {
    let response: any = null;
    let address: any = null;

    const options = 'tokens=nonzero&details=txs';

    if (isHardwareWallet) {
      response = await sys.utils.fetchBackendAccount(
        sysjs.blockbookURL,
        xpub,
        options,
        true
      );

      const account = new fromZPub(
        xpub,
        sysjs.Signer.Signer.pubtypes,
        sysjs.Signer.Signer.networks
      );
      let receivingIndex = -1;

      if (response.tokens) {
        response.tokens.forEach((token: any) => {
          if (token.path) {
            const splitPath = token.path.split('/');

            if (splitPath.length >= 6) {
              const change = parseInt(splitPath[4], 10);
              const index = parseInt(splitPath[5], 10);

              if (change === 1) return;

              if (index > receivingIndex) {
                receivingIndex = index;
              }
            }
          }
        });
      }

      address = account.getAddress(receivingIndex + 1);
    } else {
      response = await sys.utils.fetchBackendAccount(
        sysjs.blockbookURL,
        sysjs.Signer.getAccountXpub(),
        options,
        true
      );
    }

    return {
      address,
      response,
    };
  };

  const getAccountInfo = async (
    isHardwareWallet?: boolean,
    xpub?: any
  ): Promise<IAccountInfo> => {
    const { address, response } = await fetchAccountInfo(
      isHardwareWallet,
      xpub
    );

    const assets: Assets[] = [];
    let transactions: Transaction[] = [];

    if (response.transactions)
      transactions = response.transactions.slice(0, 20);

    if (response.tokensAsset) {
      // TODO: review this reduce
      const transform = response.tokensAsset.reduce(
        (item: any, { type, assetGuid, symbol, balance, decimals }: Assets) => {
          item[assetGuid] = <Assets>{
            type,
            assetGuid,
            symbol: symbol ? atob(String(symbol)) : '',
            balance:
              (item[assetGuid] ? item[assetGuid].balance : 0) + Number(balance),
            decimals,
          };

          return item;
        },
        {}
      );

      for (const key in transform) {
        assets.push(transform[key]);
      }
    }

    return {
      address,
      assets,
      balance: response.balance / 1e8,
      transactions,
    };
  };

  const updateActiveAccount = async () => {
    const activeAccount = getActiveAccount();

    if (!activeAccount) return;
    globalAccount = activeAccount;

    let updateAccountInfo: IAccountInfo;

    if (activeAccount.isTrezorWallet) {
      const trezorData = await getAccountInfo(true, globalAccount?.xpub);
      if (!trezorData) return;

      updateAccountInfo = trezorData;
    } else {
      sysjs.Signer.setAccountIndex(activeAccount.id);

      const accLatestInfo = await getAccountInfo();
      if (!accLatestInfo) return;

      updateAccountInfo = accLatestInfo;
    }

    store.dispatch(
      updateAccount({
        id: activeAccount.id,
        ...updateAccountInfo,
      })
    );

    store.dispatch(updateSwitchNetwork(false));
  };

  const updateTxs = () => {
    if (globalAccount) updateActiveAccount();
  };

  const setAddress = (addr: string) => {
    // ? why get the accId from the store to pass it to the store?
    const { activeAccountId }: IWalletState = store.getState().wallet;

    store.dispatch(
      updateAccountAddress({
        id: activeAccountId,
        address: { main: addr },
      })
    );

    return true;
  };

  const setXpub = (id: number, xpub: string, xprv: string, key: string) => {
    store.dispatch(
      updateAccountXpub({
        id,
        xpub,
        xprv: CryptoJS.AES.encrypt(xprv, String(key)).toString(),
      })
    );
  };

  // ? is named 'get' but does not return anything
  const getPrimaryAccount = (pwd: string, sjs: any) => {
    const { accounts }: IWalletState = store.getState().wallet;

    // ? does this belong here
    if (sjs) sysjs = sjs;

    if (!actions.checkPassword(pwd)) return;

    updateActiveAccount();

    // ? the operation of 'globalAccount = getActiveAccount()'
    // ? is already performed at updateActiveAccount function
    if (!globalAccount && accounts) {
      globalAccount = getActiveAccount();

      // ? is this supposed to be inside this if?
      store.dispatch(updateStatus());
    }
  };

  // ? 'fromConnectionsController' seems to be always true
  // name could be better
  // Trezor only
  const getNewChangeAddress = async (fromConnectionsController = true) => {
    const account = fromConnectionsController
      ? getConnectedAccount()
      : getActiveAccount();

    if (account?.isTrezorWallet) {
      const response = await sys.utils.fetchBackendAccount(
        sysjs.blockbookURL,
        account.xpub,
        'tokens=nonzero&details=txs',
        true
      );

      const trezorAccount = new fromZPub(
        account.xpub,
        sysjs.Signer.Signer.pubtypes,
        sysjs.Signer.Signer.networks
      );
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

      return trezorAccount.getAddress(changeIndex + 1, true);
    }
  };

  const fetchBackendConnectedAccount = async (
    connectedAccount: IAccountState
  ) => {
    const backendAccount = await sys.utils.fetchBackendAccount(
      sysjs.blockbookURL,
      globalAccount?.xpub,
      'tokens=nonzero&details=txs',
      true
    );

    const paliAccount = await sys.utils.fetchBackendAccount(
      sysjs.blockbookURL,
      connectedAccount.xpub,
      'details=txs&assetMask=non-token-transfers',
      true
    );

    return connectedAccount.isTrezorWallet ? backendAccount : paliAccount;
  };

  // this function is really useful but it not being used where it could
  const getChangeAddress = async () => {
    const connectedAccount: IAccountState = getConnectedAccount();

    if (!sysjs) {
      console.log('SYSJS not defined');

      return 'Error: wallet is locked, ask client to unlock it to get change address';
    }

    if (connectedAccount.isTrezorWallet) {
      const addr = 'Error: Failed to fetch trezor change address';

      const newAddr = await getNewChangeAddress(true);

      return newAddr ?? addr;
    }

    return sysjs.Signer.getNewChangeAddress(true);
  };

  const updateTokens = async () => {
    if (!sysjs) return;

    const { accounts }: IWalletState = store.getState().wallet;

    return Promise.all(
      accounts.map(async (account: IAccountState) => {
        const { tokensAsset } = await sys.utils.fetchBackendAccount(
          sysjs.blockbookURL,
          account.xpub,
          'tokens=derived&details=txs',
          true
        );

        if (!tokensAsset) {
          store.dispatch(
            updateAllTokens({
              accountId: account.id,
              accountXpub: account.xpub,
              tokens: {},
              holdings: [],
              mintedTokens: [],
            })
          );

          return;
        }

        const assets: { [assetGuid: string]: Assets } = {};

        // populate assets iterating through tokensAsset
        await new Promise((resolve) => {
          each(
            tokensAsset,
            ({ balance, symbol, assetGuid, decimals, type }: Assets, done) => {
              assets[assetGuid] = {
                balance:
                  Number(assets[assetGuid] ? assets[assetGuid].balance : 0) +
                  Number(balance),
                type,
                decimals,
                symbol: symbol ? atob(String(symbol)) : '',
                assetGuid,
              };

              done();
            },
            () => resolve('ok')
          );
        });

        const { transactions } = await fetchBackendConnectedAccount(account);
        const mintedTokens: { [token: string]: IMintedToken } = {};

        // populate mintedTokens iterating through transactions
        try {
          if (transactions) {
            await new Promise((resolve) => {
              each(
                transactions,
                ({ tokenType, tokenTransfers }: any, done: any) => {
                  if (tokenType === 'SPTAssetActivate') {
                    for (const token of tokenTransfers) {
                      try {
                        getAsset(token.token).then((assetData) => {
                          mintedTokens[token.token] = <IMintedToken>{
                            assetGuid: token.token,
                            symbol: token.symbol
                              ? atob(String(token.symbol))
                              : '',
                            maxSupply: Number(assetData.maxSupply),
                            totalSupply: Number(assetData.totalSupply),
                          };
                        });
                      } catch (error) {
                        console.log(error);
                      }
                    }
                  }

                  done();
                },
                () => resolve('ok')
              );
            });
          }

          const assetsData = {};

          // populate assetsData iterating through tokensMap
          await Promise.all(
            Object.values(assets).map(async (asset: Assets) => {
              try {
                const { balance, type, decimals, symbol, assetGuid } = asset;

                const {
                  pubData,
                  contract,
                  totalSupply,
                  maxSupply,
                  updateCapabilityFlags,
                } = await getAsset(assetGuid);

                const { baseAssetID, NFTID } = sys.utils.getAssetIDs(assetGuid);

                const assetData = {
                  contract,
                  totalSupply,
                  maxSupply,
                  updateCapabilityFlags,
                  balance,
                  type,
                  decimals,
                  symbol,
                  assetGuid,
                  baseAssetID,
                  childAssetID: isNFT(assetGuid)
                    ? sys.utils.createAssetID(NFTID, assetGuid)
                    : null,
                  NFTID,
                  description:
                    pubData && pubData.desc ? atob(pubData.desc) : '',
                };

                assetsData[assetData.assetGuid] = assetData;

                return;
              } catch (error) {
                console.log('error minted tokens', error);
              }
            })
          );

          store.dispatch(
            updateAllTokens({
              accountId: account.id,
              accountXpub: account.xpub,
              tokens: assets,
              holdings: sortList(Object.values(assetsData)),
              mintedTokens: sortList(Object.values(mintedTokens)),
            })
          );

          return;
        } catch (error) {
          console.log(error);
        }
      })
    );
  };

  // ? is return type Holdings[]?
  const getHoldings = async () => {
    const { walletTokens }: IWalletState = store.getState().wallet;

    if (walletTokens) {
      const tokenIndex = walletTokens.findIndex(
        (token) => token.accountId === getConnectedAccount().id
      );

      if (tokenIndex > -1) {
        return walletTokens[tokenIndex].holdings;
      }
    }

    return [];
  };

  const getMintedTokens = async () => {
    const { walletTokens }: IWalletState = store.getState().wallet;

    if (walletTokens) {
      const tokenIndex = walletTokens.findIndex(
        (token) => token.accountId === getConnectedAccount().id
      );

      if (tokenIndex > -1) {
        return walletTokens[tokenIndex].mintedTokens;
      }
    }

    return [];
  };

  const signTransaction = async (jsonData: any, sendPSBT: boolean) => {
    // needs comment
    const base64 =
      /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

    if (!base64.test(jsonData.psbt) || typeof jsonData.assets !== 'string') {
      throw new Error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );
    }

    try {
      const response = sys.utils.importPsbtFromJson(jsonData);

      if (!TrezorSigner) setTrezorSigner();

      const { isTrezorWallet } = getConnectedAccount();

      // ? sendPSBT could have a better name
      // ? when its true, it doesnt send (??)
      let psbt;
      if (sendPSBT) {
        if (isTrezorWallet) {
          psbt = await TrezorSigner.sign(response.psbt);
        } else {
          psbt = await sysjs.Signer.sign(response.psbt);
        }

        return sys.utils.exportPsbtToJson(psbt);
      }

      if (isTrezorWallet) {
        psbt = await sysjs.signAndSend(
          response.psbt,
          response.assets,
          TrezorSigner
        );
      } else {
        psbt = await sysjs.signAndSend(response.psbt, response.assets);
      }

      return sys.utils.exportPsbtToJson(psbt);
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
  };

  const subscribeAccount = async (
    encriptedPassword: any,
    isHardwareWallet = false,
    sjs?: any,
    label?: string,
    walletCreation?: boolean
  ): Promise<string | null> => {
    if (isHardwareWallet) {
      if (TrezorSigner === null || TrezorSigner === undefined) {
        TrezorSigner = sjs;
        new sys.SyscoinJSLib(TrezorSigner, sysjs.blockbookURL);
      }

      const { accounts }: IWalletState = store.getState().wallet;
      const trezorID: number = accounts.reduce(
        (currentTrezorID: number, acc: IAccountState) => {
          if (acc.trezorId) {
            if (currentTrezorID > acc.trezorId) return currentTrezorID;
            return acc.trezorId;
          }
          return currentTrezorID;
        },
        0
      );

      const trezorInfo = await getAccountInfo(
        isHardwareWallet,
        sjs.getAccountXpub()
      );

      // ? if this is false, nothing is done
      if (trezorInfo.address) {
        globalAccount = {
          id: 9999 + trezorID,
          label: `Trezor ${trezorID + 1}`,
          balance: trezorInfo.balance / 10 ** 8,
          transactions: trezorInfo.transactions,
          xpub: sjs.getAccountXpub(),
          xprv: '',
          address: { main: trezorInfo.address },
          assets: trezorInfo.assets,
          connectedTo: [],
          isTrezorWallet: true,
          trezorId: trezorID + 1,
        };

        store.dispatch(createAccount(globalAccount));

        return globalAccount.xpub;
      }

      return null;
    }

    if (sjs) sysjs = sjs;

    if (!walletCreation) {
      await sysjs.Signer.createAccount();
    }

    const account = await getAccountInfo();

    let mainAddress = '';

    try {
      mainAddress = await sysjs.Signer.getNewReceivingAddress(true);

      console.log('sysjs signer', sysjs.Signer.Signer.blockbookURL);
      console.log('sysjs signer', sysjs.Signer);
      console.log('main address get new receiving address', mainAddress);
    } catch (error: any) {
      console.log('error getting receiving address from sys', error);
      throw new Error(error);
    }

    const signer = sysjs.Signer.Signer;

    globalAccount = {
      id: signer.accountIndex,
      label: label ?? `Account ${signer.accountIndex + 1}`,
      balance: account.balance,
      transactions: account.transactions,
      xpub: sysjs.Signer.getAccountXpub(),
      xprv: CryptoJS.AES.encrypt(
        signer.accounts[signer.accountIndex].getAccountPrivateKey(),
        encriptedPassword
      ).toString(),
      address: { main: mainAddress },
      assets: account.assets,
      connectedTo: [],
      isTrezorWallet: false,
    };

    store.dispatch(createAccount(globalAccount));

    return globalAccount.xpub;
  };

  const isValidSYSAddress = (
    address: string,
    network: string,
    verification = true
  ) => {
    if (!verification) return true;

    // ? this if might be unnecessary
    if (address && typeof address === 'string') {
      try {
        const decodedAddr = bech32.decode(address);

        if (
          (network === 'main' && decodedAddr.prefix === 'sys') ||
          (network === 'testnet' && decodedAddr.prefix === 'tsys')
        ) {
          const encode = bech32.encode(decodedAddr.prefix, decodedAddr.words);
          return encode === address.toLowerCase();
        }
      } catch (error) {
        return false;
      }
    }

    return false;
  };

  const handleTransactionExecution = async (
    item,
    executeTransaction,
    condition?: boolean
  ) => {
    if (!sysjs) throw new Error('Error: No signed account exists');

    if (!globalAccount)
      throw new Error("Error: Can't find active account info");

    if (!item) throw new Error("Error: Can't find item info");

    return new Promise((resolve, reject) => {
      executeTransaction(item, condition)
        .then((response) => resolve(response))
        .catch((error) => reject(error));
    });
  };

  // ? unsuggestive name
  // ? currentAccount could be currentAccountId
  // ? passing a null 'currentAccount' could default to connected account
  const watchMemPool = (currentAccount: IAccountState | undefined) => {
    if (intervalId) return true;

    // 30 seconds
    const intervalInMs = 30 * 1000;

    intervalId = setInterval(() => {
      updateActiveAccount();

      const { accounts }: IWalletState = store.getState().wallet;

      const activeAccount = accounts.find(
        (account: IAccountState) => account.id === currentAccount?.id
      );

      if (
        !activeAccount ||
        !activeAccount?.transactions ||
        !activeAccount?.transactions.filter(
          (tx: Transaction) => tx.confirmations > 0
        ).length
      ) {
        clearInterval(intervalId);

        return false;
      }
    }, intervalInMs);

    return true;
  };

  //* ----- Confirmations -----

  type AssetMap = [
    [
      token: any,
      map: {
        changeAddress: string | null;
        outputs: [
          {
            address: string | null;
            value: any;
          }
        ];
      }
    ]
  ];

  // ? parameter 'item' has 'NewAsset' type at IAccountController
  // ? but it has a lot of different fields
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
      receiver,
    } = item;

    const newMaxSupply = maxsupply * 10 ** precision;

    const assetOpts = {
      precision,
      symbol,
      description,
      maxsupply: new sys.utils.BN(newMaxSupply),
      updatecapabilityflags: capabilityflags ? String(capabilityflags) : '127',
      notarydetails,
      auxfeedetails,
      notarykeyid: Buffer.from('', 'hex'),
    };

    if (notaryAddress) {
      const vNotaryPayment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: notaryAddress,
        network: sysjs.Signer.Signer.network,
      });

      assetOpts.notarydetails.endpoint = Buffer.from(
        syscointx.utils.encodeToBase64(notarydetails.endpoint)
      );

      assetOpts.notarykeyid = Buffer.from(
        vNotaryPayment.hash.toString('hex'),
        'hex'
      );
    }

    if (payoutAddress) {
      const payment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: payoutAddress,
        network: sysjs.Signer.Signer.network,
      });

      const auxFeeKeyID = Buffer.from(payment.hash.toString('hex'), 'hex');

      assetOpts.auxfeedetails.auxfeekeyid = auxFeeKeyID;
    }

    // ? assetOpts already contains auxfeedetails
    // this seems to override the previous auxFeeKeyID assign
    if (auxfeedetails) {
      assetOpts.auxfeedetails = auxfeedetails;
    }

    const txOpts = { rbf: true };

    const connectedAccount = getConnectedAccount();

    if (connectedAccount.isTrezorWallet)
      throw new Error("Trezor don't support burning of coins");

    sysjs.Signer.setAccountIndex(connectedAccount.id);

    // ? 'pendingTx' could be named newAsset
    const pendingTx = await sysjs.assetNew(
      assetOpts,
      txOpts,
      await sysjs.Signer.getNewChangeAddress(true),
      receiver,
      new sys.utils.BN(fee * 1e8)
    );

    const newTx = pendingTx.extractTransaction();
    const newTxId = newTx.getId();

    updateTransactionData(newTxId);

    const assets = syscointx.getAssetsFromTx(newTx);
    const createdAssetGuid = assets.keys().next().value;

    if (initialSupply && initialSupply < newMaxSupply) {
      try {
        return await new Promise((resolve: any, reject: any) => {
          const interval = setInterval(async () => {
            const updatedTransaction = await getTransaction(newTxId);

            if (updatedTransaction.confirmations > 1) {
              console.log('confirmations > 1', createdAssetGuid);

              const changeAddress = await sysjs.Signer.getNewChangeAddress(
                true
              );

              try {
                const assetMap = new Map([
                  [
                    String(createdAssetGuid),
                    {
                      changeAddress,
                      outputs: [
                        {
                          value: new sys.utils.BN(
                            initialSupply * 10 ** precision
                          ),
                          address: receiver,
                        },
                      ],
                    },
                  ],
                ]);

                const pendingAssetSend = await sysjs.assetSend(
                  txOpts,
                  assetMap,
                  receiver,
                  new sys.utils.BN(fee * 1e8)
                );

                if (!pendingAssetSend) {
                  console.log(
                    'Could not create transaction, not enough funds?'
                  );

                  return;
                }

                const txid = pendingAssetSend.extractTransaction().getId();

                updateTransactionData(txid);
                watchMemPool(connectedAccount);
                clearInterval(interval);

                resolve({
                  sptCreated: updatedTransaction,
                  txid,
                  txConfirmations: updatedTransaction.confirmations,
                  txAssetGuid: createdAssetGuid,
                });
              } catch (error) {
                clearInterval(interval);
                reject(error);
              }
            }
          }, 16000);
        });
      } catch (error: any) {
        console.log(error);

        throw new Error(error);
      }
    }

    const transaction = await getTransaction(newTxId);

    // ? why return transaction, transaction.confirmations and its id?
    // return could be { transaction, assetGuid }
    return {
      transactionData: transaction,
      txid: newTxId,
      txConfirmations: transaction.confirmations,
      txAssetGuid: createdAssetGuid,
    };
  };

  // ? return could be just the txid
  const confirmMintSPT = async (
    item: MintAsset
  ): Promise<{ txid: string } | undefined> => {
    const { fee, assetGuid, amount } = item;

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };

    const connectedAccount = getConnectedAccount();
    if (!connectedAccount.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(connectedAccount.id);
    }

    const { decimals } = await getAsset(assetGuid);
    const receivingAddress = await sysjs.Signer.getNewReceivingAddress(true);

    const assetMap = new Map([
      [
        assetGuid,
        {
          changeAddress: connectedAccount.isTrezorWallet
            ? await getNewChangeAddress(true)
            : await sysjs.Signer.getNewChangeAddress(true),
          outputs: [
            {
              value: new sys.utils.BN(amount * 10 ** decimals),
              address: receivingAddress,
            },
          ],
        },
      ],
    ]);

    let txid: string;
    if (connectedAccount.isTrezorWallet) {
      const txData = await sysjs.assetSend(
        txOpts,
        assetMap,
        await getNewChangeAddress(true),
        feeRate,
        globalAccount?.xpub
      );

      if (!txData) {
        console.log('Could not create transaction, not enough funds?');
        return;
      }

      if (!TrezorSigner) setTrezorSigner();

      try {
        sysjs
          .signAndSend(txData.psbt, txData.assets, TrezorSigner)
          .then((signedTxid: string) => {
            updateTransactionData(signedTxid);
            watchMemPool(connectedAccount);
            return { txid: signedTxid };
          });

        return;
      } catch (error) {
        console.log(`error processing tx: ${error}`);
        return;
      }
    } else {
      const pendingTx = await sysjs.assetSend(
        txOpts,
        assetMap,
        await sysjs.Signer.getNewChangeAddress(true),
        feeRate
      );

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?');
        return;
      }

      txid = pendingTx.extractTransaction().getId();
    }

    updateTransactionData(txid);
    watchMemPool(connectedAccount);
    return { txid };
  };

  // private
  const createParentAsset = async (
    assetOpts: any,
    fee: number
  ): Promise<{ assetGuid: string; txid: string } | undefined> => {
    const txOpts: any = { rbf: true };
    const feeRate = new sys.utils.BN(fee * 1e8);

    const connectedAccount = getConnectedAccount();
    if (!connectedAccount.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(connectedAccount.id);
    }

    const assetChangeAddress = await sysjs.Signer.getNewChangeAddress(true);

    const psbt = await sysjs.assetNew(
      assetOpts,
      txOpts,
      assetChangeAddress,
      assetChangeAddress,
      feeRate
    );

    if (!psbt) {
      console.log('Could not create transaction, not enough funds?');
      return;
    }

    const assets = syscointx.getAssetsFromTx(psbt.extractTransaction());
    const txid = psbt.extractTransaction().getId();

    return {
      assetGuid: assets.keys().next().value,
      txid,
    };
  };

  /**
   * This function executs do multiples transactions in sys
   * blockchain  which must be executed in series
   * WARNING: It might take a few minutes to execute it be carefull
   * when using it
   */
  const confirmCreateNFT = async (
    item: any
  ): Promise<{ txid: string } | undefined> => {
    const { fee, symbol, description, issuer, precision } = item;

    const connectedAccount = getConnectedAccount();
    if (connectedAccount.isTrezorWallet) {
      throw new Error('trezor does not support nft creation');
    } else {
      sysjs.Signer.setAccountIndex(connectedAccount.id);
    }

    const assetOpts = {
      precision,
      symbol,
      maxsupply: new sys.utils.BN(1 * 10 ** precision),
      description,
    };

    const parentAsset = await createParentAsset(assetOpts, fee);
    console.log('current parent asset', parentAsset);

    if (!parentAsset?.assetGuid) return;

    try {
      return await new Promise((resolve) => {
        const interval = setInterval(async () => {
          let isParentConfirmed = false;
          let txid: string | undefined;
          let assetMap;

          const newParentTx = await getTransaction(parentAsset.txid);
          let feeRate = new sys.utils.BN(fee * 1e8);
          let txOpts = { rbf: true };

          if (newParentTx.confirmations >= 1 && !isParentConfirmed) {
            isParentConfirmed = true;

            console.log('confirmations parent tx > 1', parentAsset);

            assetMap = new Map([
              [
                parentAsset?.assetGuid,
                {
                  changeAddress: null,
                  outputs: [
                    {
                      value: new sys.utils.BN(1 * 10 ** precision),
                      address: issuer,
                    },
                  ],
                },
              ],
            ]);

            try {
              const pendingTx = await sysjs.assetSend(
                txOpts,
                assetMap,
                null,
                feeRate
              );

              if (!pendingTx) {
                console.log('Could not create transaction, not enough funds?');
                return;
              }

              txid = pendingTx.extractTransaction().getId();

              updateTransactionData(txid);
            } catch (error) {
              isParentConfirmed = false;
              return error;
            }

            return;
          }

          // ? this if always returns since txid is never assigned
          if (!txid) return;

          let nftTx: Transaction;
          try {
            nftTx = await getTransaction(txid);
          } catch (error) {
            console.log('Transaction still not indexed by explorer:', error);
            return;
          }

          if (!(nftTx.confirmations > 1)) return;

          feeRate = new sys.utils.BN(10);
          txOpts = { rbf: true };
          const assetGuid = parentAsset?.assetGuid;
          const assetOpt = { updatecapabilityflags: '0' };

          assetMap = new Map([
            [
              assetGuid,
              {
                changeAddress: null,
                outputs: [
                  {
                    value: new sys.utils.BN(0),
                    address: issuer,
                  },
                ],
              },
            ],
          ]);

          const psbt = await sysjs.assetUpdate(
            assetGuid,
            assetOpt,
            txOpts,
            assetMap,
            issuer,
            feeRate
          );

          console.log('after update psbt', psbt);

          if (!psbt) {
            console.log('Could not create transaction, not enough funds?');
            // ? missing return
          }

          clearInterval(interval);

          resolve({ txid: psbt.extractTransaction().getId() });
        }, 16000);
      });
    } catch (error) {
      console.log('error sending child nft to creator', error);
    }
  };

  const confirmMintNFT = async (item: MintAsset) => {
    const { fee, amount, assetGuid } = item;

    const { decimals } = await getAsset(assetGuid);
    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };

    const assetMap = new Map([
      [
        assetGuid,
        {
          changeAddress: await sysjs.Signer.getNewChangeAddress(true),
          outputs: [
            {
              value: new sys.utils.BN(amount * 10 ** decimals),
              address: await sysjs.Signer.getNewReceivingAddress(true),
            },
          ],
        },
      ],
    ]);

    try {
      const connectedAccount = getConnectedAccount();
      if (!connectedAccount.isTrezorWallet) {
        sysjs.Signer.setAccountIndex(connectedAccount.id);
      }

      const pendingTx = await sysjs.assetSend(
        txOpts,
        assetMap,
        await sysjs.Signer.getNewChangeAddress(true),
        feeRate
      );

      if (!pendingTx) {
        console.log('Could not create transaction, not enough funds?');
        // ? missing return
      }

      const txid = pendingTx.extractTransaction().getId();
      updateTransactionData(txid);
      return { txid };
    } catch (error) {
      return error;
    }
  };

  // private
  const estimateSysTxFee = async (items: any) => {
    const { outputsArray, changeAddress, feeRateBN } = items;

    const txOpts = { rbf: false };

    const utxos = await sys.utils.fetchBackendUTXOS(
      sysjs.blockbookURL,
      globalAccount?.xpub
    );
    const utxosSanitized = sys.utils.sanitizeBlockbookUTXOs(
      null,
      utxos,
      sysjs.network
    );

    // 0 feerate to create tx, then find bytes and multiply feeRate by bytes to get estimated txfee
    const tx = await syscointx.createTransaction(
      txOpts,
      utxosSanitized,
      changeAddress,
      outputsArray,
      new sys.utils.BN(0)
    );
    const bytes = coinSelectSyscoin.utils.transactionBytes(
      tx.inputs,
      tx.outputs
    );
    const txFee = feeRateBN.mul(new sys.utils.BN(bytes));

    return txFee;
  };

  const confirmSendAssetTransaction = async (
    item: SendAsset
  ): Promise<void> => {
    const { toAddress, amount, fee, token, isToken, rbf } = item;

    store.dispatch(
      setTemporaryTransactionState({
        executing: true,
        type: 'sendAsset',
      })
    );

    const feeRateBN = new sys.utils.BN(fee * 1e8);

    if (isToken && token) {
      const { decimals } = await getAsset(token);
      const txOpts = { rbf };

      const value = new sys.utils.BN(amount * 10 ** decimals);
      const valueDecimals = countDecimals(amount);
      if (valueDecimals > decimals) {
        throw new Error(
          `This token has ${decimals} decimals and you are trying to send a value with ${valueDecimals} decimals, please check your tx`
        );
      }

      const map: AssetMap = [
        [
          token,
          {
            changeAddress: globalAccount?.isTrezorWallet
              ? await getNewChangeAddress(true)
              : null,
            outputs: [
              {
                value,
                address: toAddress,
              },
            ],
          },
        ],
      ];

      const assetMap = new Map(map);

      let txid: string;
      if (globalAccount?.isTrezorWallet) {
        const txData = await sysjs.assetAllocationSend(
          txOpts,
          assetMap,
          await getNewChangeAddress(true),
          feeRateBN,
          globalAccount?.xpub
        );

        if (!txData) {
          console.log('Could not create transaction, not enough funds?');
          // ? missing return
        }

        if (!TrezorSigner) setTrezorSigner();

        try {
          sysjs
            .signAndSend(txData.psbt, txData.assets, TrezorSigner)
            .then(() => {
              const confirmingAccount = store.getState().wallet
                .confirmingTransaction
                ? getConnectedAccount()
                : globalAccount;

              watchMemPool(confirmingAccount);
            });

          // ? will always call this with txid === null
          // updateTransactionData(txid);
          updateTransactionData(null);

          clearTemporaryTransaction('sendAsset');

          return;
        } catch (e) {
          return;
        }
      } else {
        const pendingTx = await sysjs.assetAllocationSend(
          txOpts,
          assetMap,
          null,
          feeRateBN
        );

        txid = pendingTx.extractTransaction().getId();
      }

      updateTransactionData(txid);
    } else {
      const backendAccount = await sys.utils.fetchBackendAccount(
        sysjs.blockbookURL,
        globalAccount?.xpub,
        {},
        true
      );
      const value = new sys.utils.BN(amount * 1e8);

      let outputsArray = [
        {
          address: toAddress,
          value,
        },
      ];

      const txOpts = { rbf: false };

      const txFee = await estimateSysTxFee({
        outputsArray,
        changeAddress: await sysjs.Signer.getNewChangeAddress(true),
        feeRateBN,
      });

      if (value.add(txFee).gte(backendAccount.balance)) {
        outputsArray = [
          {
            address: toAddress,
            value: value.sub(txFee),
          },
        ];
      }

      let txid: string;
      if (globalAccount?.isTrezorWallet) {
        const txData = await sysjs.createTransaction(
          txOpts,
          await getNewChangeAddress(true),
          outputsArray,
          feeRateBN,
          globalAccount?.xpub
        );

        if (!txData) {
          console.log('Could not create transaction, not enough funds?');
        }

        if (!TrezorSigner) setTrezorSigner();

        try {
          sysjs
            .signAndSend(txData.psbt, txData.assets, TrezorSigner)
            .then(() => {
              const sendAssetDeclaration =
                store.getState().wallet.temporaryTransactionState.type ===
                'sendAsset';

              const currentAccount = sendAssetDeclaration
                ? globalAccount
                : getConnectedAccount();

              watchMemPool(currentAccount);
            });

          // ? will always call this with txid === null
          // updateTransactionData(txid);
          updateTransactionData(null);

          clearTemporaryTransaction('sendAsset');

          return;
        } catch (e) {
          console.log(`Error processing tx: ${e}`);
          return;
        }
      } else {
        try {
          const pendingTx = await sysjs.createTransaction(
            txOpts,
            await sysjs.Signer.getNewChangeAddress(true),
            outputsArray,
            feeRateBN
          );

          txid = pendingTx.extractTransaction().getId();
        } catch (error) {
          throw new Error(String(error));
        }
      }

      updateTransactionData(txid);
    }

    const isSendAsset =
      store.getState().wallet.temporaryTransactionState.type === 'sendAsset';

    clearTemporaryTransaction('sendAsset');

    const acc = isSendAsset ? globalAccount : getConnectedAccount();
    watchMemPool(acc);
  };

  const confirmTemporaryTransaction = ({ type, callback }) =>
    new Promise((resolve, reject) => {
      try {
        const response = handleTransactionExecution(
          getTemporaryTransaction(type),
          callback
        );

        resolve(response);
      } catch (error: any) {
        reject(error);
      }
    });

  // 'item' is close to 'UpdateAsset' type
  const confirmUpdateAsset = async (
    item: any
  ): Promise<{ txid: string } | undefined> => {
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
      payoutAddress,
    } = item;

    const txOpts: any = { rbf: true };

    let assetOpts: any = {
      updatecapabilityflags: capabilityflags ? String(capabilityflags) : '127',
      description,
    };

    if (assetWhiteList) {
      txOpts.assetWhiteList = assetWhiteList;
    }

    if (notarydetails) {
      assetOpts = {
        ...assetOpts,
        notarydetails,
        auxfeedetails,
        notarykeyid: null,
      };
    }

    if (contract) {
      assetOpts.contract = Buffer.from(contract, 'hex');
    }

    if (auxfeedetails) {
      const scalarPct = 1000;
      const payment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: payoutAddress,
        network: sysjs.Signer.Signer.network,
      });
      const auxfeekeyid = Buffer.from(payment.hash.toString('hex'), 'hex');

      assetOpts = {
        ...assetOpts,
        auxfeedetails: {
          auxfeekeyid,
          auxfees: [
            {
              bound: new sys.utils.BN(0),
              percent: 1 * scalarPct,
            },
          ],
        },
      };
    }

    if (notaryAddress) {
      const vNotaryPayment = sys.utils.bitcoinjs.payments.p2wpkh({
        address: notaryAddress,
        network: sysjs.Signer.Signer.network,
      });

      assetOpts.notarykeyid = Buffer.from(
        vNotaryPayment.hash.toString('hex'),
        'hex'
      );
    }

    console.log('asset opts update asset', assetOpts, assetGuid);

    const assetMap = new Map([
      [
        assetGuid,
        {
          changeAddress: await sysjs.Signer.getNewChangeAddress(true),
          outputs: [
            {
              value: new sys.utils.BN(0),
              address: await sysjs.Signer.getNewReceivingAddress(true),
            },
          ],
        },
      ],
    ]);

    const connectedAccount = getConnectedAccount();
    if (!connectedAccount.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(connectedAccount.id);
    }

    const pendingTx = await sysjs.assetUpdate(
      assetGuid,
      assetOpts,
      txOpts,
      assetMap,
      null,
      new sys.utils.BN(fee * 1e8)
    );

    const txid = pendingTx.extractTransaction().getId();

    if (!txid) {
      console.log('Could not create transaction, not enough funds?');
      return;
    }

    updateTransactionData(txid);
    watchMemPool(connectedAccount);
    return { txid };
  };

  const confirmAssetTransfer = async (item: TransferAsset) => {
    const { fee, assetGuid, newOwner } = item;
    const connectedAccount = getConnectedAccount();

    if (!connectedAccount.isTrezorWallet) {
      sysjs.Signer.setAccountIndex(connectedAccount.id);
    }

    const feeRate = new sys.utils.BN(fee * 1e8);
    const txOpts = { rbf: true };

    const assetMap = new Map([
      [
        assetGuid,
        {
          changeAddress: connectedAccount.isTrezorWallet
            ? await getNewChangeAddress(true)
            : await sysjs.Signer.getNewChangeAddress(true),
          outputs: [
            {
              value: new sys.utils.BN(0),
              address: newOwner,
            },
          ],
        },
      ],
    ]);

    let txid: string;
    if (connectedAccount.isTrezorWallet) {
      const txData = await sysjs.assetUpdate(
        assetGuid,
        {},
        txOpts,
        assetMap,
        await getNewChangeAddress(true),
        feeRate
      );

      if (!txData) {
        console.log('Could not create transaction, not enough funds?');
        // ? missing return
      }

      if (!TrezorSigner) setTrezorSigner();

      try {
        // TODO: test might have same problem as them mintSPT
        // ? it seems like 'extractTransaction().getId()' is missing
        txid = await sysjs.signAndSend(
          txData.psbt,
          txData.assets,
          TrezorSigner
        );

        updateTransactionData(txid);
        watchMemPool(connectedAccount);
        // ? return txid?
      } catch (e) {
        console.log(`Error processing tx: ${e}`);
        return;
      }
      return;
    }

    const pendingTx = await sysjs.assetUpdate(
      assetGuid,
      {},
      txOpts,
      assetMap,
      null,
      feeRate
    );

    if (!pendingTx) {
      console.log('Could not create transaction, not enough funds?');
      // ? missing return?
    }

    txid = pendingTx.extractTransaction().getId();

    updateTransactionData(txid);
    watchMemPool(connectedAccount);
    return { txid };
  };

  return {
    updateNetworkData,
    subscribeAccount,
    temporaryTransaction,
    getPrimaryAccount,
    updateAccountLabel,
    getLatestUpdate: updateActiveAccount,
    watchMemPool,
    confirmTemporaryTransaction,
    isValidSYSAddress,
    updateTxs,
    getRecommendFee,
    setNewAddress: setAddress,
    setNewXpub: setXpub,
    getUserMintedTokens: getMintedTokens,
    getTransactionInfoByTxId: getTransaction,
    getSysExplorerSearch: getBlockbookURL,
    getHoldingsData: getHoldings,
    getDataAsset: getAsset,
    clearTemporaryTransaction,
    getConnectedAccount,
    getChangeAddress,
    updateTokensState: updateTokens,
    getRawTransaction: getTransaction,
    setHDSigner,
    importPsbt,
    decryptAES,
    setAutolockTimer,
    updateTemporaryTransaction,
    getTemporaryTransaction,
    confirmSendAssetTransaction,
    confirmSPTCreation,
    confirmMintSPT,
    confirmCreateNFT,
    signTransaction,
    confirmAssetTransfer,
    confirmMintNFT,
    confirmUpdateAsset,
    connectedAccountXpub,
  };
};

export default AccountController;
