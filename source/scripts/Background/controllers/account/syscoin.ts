import {
  IKeyringAccountState,
  SyscoinHDSigner,
  SyscoinMainSigner,
} from '@pollum-io/sysweb3-utils';
import syscoin from 'syscoinjs-lib';
import { fromZPub } from 'bip84';

import { SysTransactionController } from '../transaction';
import SysTrezorController from '../trezor/syscoin';
import store from 'state/store';
import { setActiveAccount, setIsPendingBalances } from 'state/vault';

const SysAccountController = ({
  hd,
  main,
}: {
  hd: SyscoinHDSigner;
  main: SyscoinMainSigner;
}) => {
  const _fetchAccountInfo = async (isHardwareWallet?: boolean, xpub?: any) => {
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
        main.Signer.Signer.pubTypes,
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
  const _getAccountInfo = async (
    isHardwareWallet?: boolean,
    xpub?: any
  ): Promise<any> => {
    const { address, response } = await _fetchAccountInfo(
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

  const _getUpdatedAccountInfo = async (activeAccount) => {
    if (activeAccount.isTrezorWallet) {
      const trezorData = await _getAccountInfo(true, activeAccount?.xpub);

      if (!trezorData) return;

      return trezorData;
    }

    console.log(hd, main);

    const accLatestInfo = await _getAccountInfo();

    if (!accLatestInfo) return;

    return accLatestInfo;
  };

  const getLatestUpdate = async () => {
    const { activeAccount } = store.getState().vault;

    if (!activeAccount) return;

    const updatedAccountInfo = await _getUpdatedAccountInfo(activeAccount);

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
      })
    );

    store.dispatch(setIsPendingBalances(false));
  };

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = (currentAccount: IKeyringAccountState | undefined) => {
    // 30 seconds - 3000 milliseconds
    const interval = 30 * 1000;

    const intervalId = setInterval(() => {
      getLatestUpdate();

      if (!currentAccount || !currentAccount?.transactions) {
        clearInterval(intervalId);

        return false;
      }
    }, interval);

    return true;
  };

  /** get new receiving address passing true to skip increment,
   *  this way we always receive a new unused and valid address for
   *  each transaction
   */
  const setAddress = () => hd.getNewReceivingAddress(true);

  const trezor = SysTrezorController();
  const tx = SysTransactionController({ main });

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
    getLatestUpdate,
  };
};

export default SysAccountController;
