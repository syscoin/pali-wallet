import store from 'state/store';
import {
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';
import { KeyringManager } from '@pollum-io/sysweb3-keyring';
import { validateToken, IKeyringAccountState } from '@pollum-io/sysweb3-utils';

import SysTrezorController from '../trezor/syscoin';
import { SysTransactionController } from '../transaction';
import { CoingeckoCoins } from '../ControllerUtils';

const SysAccountController = () => {
  const keyringManager = KeyringManager();

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

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = (currentAccount: IKeyringAccountState | undefined) => {
    // 30 seconds - 3000 milliseconds
    const interval = 30 * 1000;

    const intervalId = setInterval(() => {
      getLatestUpdate(true);

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

  const saveTokenInfo = async (token: CoingeckoCoins) => {
    const { activeAccount } = store.getState().vault;

    console.log('saving token info', token);

    try {
      const validToken = await validateToken(String(token.contract_address));

      console.log('token is valid', validToken);

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: {
            ...activeAccount.assets,
            [String(validToken.name)]: validToken,
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
