import store from 'state/store';
import {
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';
import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccount } from 'state/vault/types';
import { validateToken } from '@pollum-io/sysweb3-utils';

import SysTrezorController from '../trezor/syscoin';
import { SysTransactionController } from '../transaction';

const SysAccountController = () => {
  const keyringManager = KeyringManager();

  const getLatestUpdate = async (silent?: boolean) => {
    if (!silent) store.dispatch(setIsPendingBalances(true));

    const { activeAccount } = store.getState().vault;

    if (!activeAccount) return;

    const updatedAccountInfo = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
        // @ts-ignore
        assets: updatedAccountInfo.assets,
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

  const setAddress = async (): Promise<string> => {
    // @ts-ignore
    const { receivingAddress } =
      await keyringManager.getLatestUpdateForAccount();

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: String(receivingAddress),
      })
    );

    return receivingAddress;
  };

  const saveTokenInfo = async (token) => {
    const { activeAccount } = store.getState().vault;

    console.log('saving token info', token);

    try {
      const validToken = await validateToken(token.contract);
      console.log('token is valid', validToken);

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: {
            ...activeAccount.assets,
            [String(validToken.symbol)]: validToken,
          },
        })
      );
    } catch (error) {
      console.log('validate errror', error);
    }
  };

  const trezor = SysTrezorController();
  const tx = SysTransactionController();

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
    getLatestUpdate,
    saveTokenInfo,
  };
};

export default SysAccountController;
