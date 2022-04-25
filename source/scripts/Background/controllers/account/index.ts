import { Web3Accounts, KeyringManager } from '@pollum-io/sysweb3-keyring';
import store from 'state/store';
import { setActiveAccount, setIsPendingBalances } from 'state/vault';

import SysAccountController from './syscoin';

const WalletController = (): {
  account: any;
  addAccount: any;
  getLatestUpdate: any;
} => {
  const keyringManager = KeyringManager();

  const controller = {
    account: {
      sys: SysAccountController(),
      eth: Web3Accounts(),
    },
  };

  const getLatestUpdate = async (silent?: boolean) => {
    if (!silent) store.dispatch(setIsPendingBalances(true));

    const { activeAccount } = store.getState().vault;

    if (!activeAccount) return;

    const updatedAccountInfo = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(setIsPendingBalances(false));

    console.log('updated account in pali going to store', updatedAccountInfo);

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
      })
    );
  };

  const addAccount = async (label: string) =>
    keyringManager.addNewAccount(label);

  return { ...controller, addAccount, getLatestUpdate };
};

export default WalletController;
