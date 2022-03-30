import store from 'state/store';
import { updateAccount, updateSwitchNetwork } from 'state/wallet';
import { fromZPub } from 'bip84';
import syscoin from 'syscoinjs-lib';
import { getActiveAccount } from 'utils/accounts';
import { Assets, IAccountInfo, Transaction } from 'types/transactions';

import EthTransactionController from '../EthTransactionController';
import SysTransactionController from '../SysTransactionController';

import SysAccountController from './syscoin';
import EthAccountController from './ethereum';
import { SignerInfo, SyscoinHDSigner } from '@pollum-io/sysweb3-utils';

export const CommonAccountController = ({ hd, main }) => {
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
  ): Promise<IAccountInfo> => {
    const { address, response } = await fetchAccountInfo(
      isHardwareWallet,
      xpub
    );

    const assets: Assets[] = [];
    let transactions: Transaction[] = [];

    if (response.transactions) {
      transactions = response.transactions.slice(0, 20);
    }

    if (response.tokensAsset) {
      // TODO: review this reduce
      const transform = response.tokensAsset.reduce(
        (item: any, { type, assetGuid, symbol, balance, decimals }: Assets) => {
          item[assetGuid] = <Assets>{
            type,
            assetGuid,
            symbol: symbol
              ? Buffer.from(symbol, 'base64').toString('utf-8')
              : '',
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

    const accountData = {
      balance: response.balance / 1e8,
      assets,
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
      main.Signer.setAccountIndex(activeAccount.id);

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

  return {
    updateActiveAccount,
    getAccountInfo,
  };
};

const AccountController = (data: {
  hd: SyscoinHDSigner;
  main: any;
  checkPassword: (pwd: string) => boolean;
}) => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const sys: any = {
    ...SysAccountController(data),
    tx: SysTransactionController(data),
    common: CommonAccountController(data),
  };

  const eth: any = {
    // ...EthAccountController(data),
    tx: EthTransactionController(data),
    common: CommonAccountController(data),
  };

  return isSyscoinNetwork ? sys : eth;
};

export default AccountController;
