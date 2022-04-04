import { SysTransactionController } from '../transaction';
import SysTrezorController from '../trezor/syscoin';
import store from 'state/store';
import { setActiveAccount, setIsPendingBalances } from 'state/vault';
import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccount } from 'state/vault/types';

const SysAccountController = () => {
  const keyringManager = KeyringManager();

  const getLatestUpdate = async () => {
    const { activeAccount } = store.getState().vault;

    if (!activeAccount) return;

    const updatedAccountInfo = await keyringManager.getLatestUpdateForAccount(
      activeAccount
    );

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
  const watchMemPool = (currentAccount: IKeyringAccount | undefined) => {
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

  const setAddress = () => keyringManager.address.getValidAddress();

  const trezor = SysTrezorController();
  const tx = SysTransactionController();

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
    getLatestUpdate,
  };
};

export default SysAccountController;
