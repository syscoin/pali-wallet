import store from 'state/store';
import syscoin from 'syscoinjs-lib';
import { fromZPub } from 'bip84';
import { setActiveAccount, setIsPendingBalances } from 'state/vault';
import { TemporaryTransaction } from 'types/transactions';
import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

export const SysTransactionController = ({ main }) => {
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

  //* ----- TemporaryTransaction -----
  const getTemporaryTransaction = (type: string) => temporaryTransaction[type];

  const clearTemporaryTransaction = (item: string) => {
    temporaryTransaction[item] = null;
  };

  const updateTemporaryTransaction = ({ tx, type }) => {
    temporaryTransaction[type] = { ...tx };
  };
  //* end

  const handleTransactionExecution = async (
    item,
    executeTransaction,
    condition?: boolean
  ) => {
    const { activeAccount } = store.getState().vault;

    if (!main) throw new Error('Error: No signed account exists');

    if (!activeAccount) {
      throw new Error("Error: Can't find active account info");
    }

    if (!item) throw new Error("Error: Can't find item info");

    return new Promise((resolve, reject) => {
      executeTransaction(item, condition)
        .then((response) => resolve(response))
        .catch((error) => reject(error));
    });
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

  const fetchAccountInfo = async (isHardwareWallet?: boolean, xpub?: any) => {
    let response: any = null;
    let address: string | null = null;

    const options = 'tokens=nonzero&details=txs';

    if (isHardwareWallet) {
      response = await syscoin.utils.fetchBackendAccount(
        main.blockbookURL,
        xpub,
        options,
        true
      );

      const account = new fromZPub(
        xpub,
        main.Signer.Signer.pubtypes,
        main.Signer.Signer.networks
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
      response = await syscoin.utils.fetchBackendAccount(
        main.blockbookURL,
        main.Signer.getAccountXpub(),
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
  ): Promise<any> => {
    const { address, response } = await fetchAccountInfo(
      isHardwareWallet,
      xpub
    );

    const tokens: any = {};
    const transactions: any = {};

    // if (response.transactions) {
    //   transactions = response.transactions.slice(0, 20);
    // }

    // if (response.tokensAsset) {
    //   // TODO: review this reduce
    //   const transform = response.tokensAsset.reduce(
    //     (item: any, { type, assetGuid, symbol, balance, decimals }: any) => {
    //       item[assetGuid] = <any>{
    //         type,
    //         assetGuid,
    //         symbol: symbol
    //           ? Buffer.from(symbol, 'base64').toString('utf-8')
    //           : '',
    //         balance:
    //           (item[assetGuid] ? item[assetGuid].balance : 0) + Number(balance),
    //         decimals,
    //       };

    //       return item;
    //     },
    //     {}
    //   );

    //   for (const key in transform) {
    //     tokens.push(transform[key]);
    //   }
    // }

    const accountData = {
      balances: {
        syscoin: response.balance / 1e8,
        ethereum: 0,
      },
      tokens,
      transactions,
    };

    if (address) {
      return {
        ...accountData,
        address,
      };
    }

    return accountData;
  };

  const getLatestUpdate = async () => {
    const { activeAccount } = store.getState().vault;

    if (!activeAccount) return;

    let updatedAccountInfo;

    if (activeAccount.isTrezorWallet) {
      const trezorData = await getAccountInfo(true, activeAccount?.xpub);
      if (!trezorData) return;

      updatedAccountInfo = trezorData;
    } else {
      main.Signer.setAccountIndex(activeAccount.id);

      const accLatestInfo = await getAccountInfo();

      if (!accLatestInfo) return;

      updatedAccountInfo = accLatestInfo;
    }

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
      })
    );

    store.dispatch(setIsPendingBalances(false));
  };

  return {
    getTemporaryTransaction,
    clearTemporaryTransaction,
    updateTemporaryTransaction,
    confirmTemporaryTransaction,
    getLatestUpdate,
  };
};
