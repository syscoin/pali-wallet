import { KeyringManager, Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { ICoingeckoToken } from '@pollum-io/sysweb3-utils';

import { SysTransactionController } from '../transaction';
import SysTrezorController from '../trezor/syscoin';
import store from 'state/store';
import {
  setAccounts,
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';

const SysAccountController = () => {
  const keyringManager = KeyringManager();

  // id for `watchMemPool` setInterval
  let intervalId: NodeJS.Timer;

  const getLatestUpdate = async (silent?: boolean) => {
    const { activeAccount } = store.getState().vault;

    if (!activeAccount.address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    const { accountLatestUpdate, walleAccountstLatestUpdate } =
      await keyringManager.getLatestUpdateForAccount();

    store.dispatch(setIsPendingBalances(false));

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...accountLatestUpdate,
      })
    );

    store.dispatch(setAccounts(walleAccountstLatestUpdate));
  };

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = () => {
    if (intervalId) clearInterval(intervalId);

    // 30 seconds - 3000 milliseconds
    const interval = 30 * 1000;

    intervalId = setInterval(() => {
      const { activeAccount } = store.getState().vault;

      if (!activeAccount.address || !activeAccount.transactions) {
        clearInterval(intervalId);

        return;
      }

      getLatestUpdate(true);
    }, interval);
  };

  const setAddress = async (): Promise<string> => {
    const {
      accountLatestUpdate: { address },
    } = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: String(address),
      })
    );

    return address;
  };

  const getErc20TokenBalance = async (
    tokenAddress: string,
    walletAddress: string
  ) => {
    try {
      const balance = await Web3Accounts().getBalanceOfAnyToken(
        tokenAddress,
        walletAddress
      );

      return balance;
    } catch (error) {
      return 0;
    }
  };

  const saveTokenInfo = async (token: ICoingeckoToken) => {
    const { activeAccount } = store.getState().vault;

    const tokenExists = activeAccount.assets.find(
      (asset: any) => asset.id === token.id
    );

    if (tokenExists) throw new Error('Token already exists');

    const balance = await getErc20TokenBalance(
      String(token.contractAddress),
      activeAccount.address
    );

    const web3Token = {
      ...token,
      balance,
    };

    store.dispatch(
      setActiveAccountProperty({
        property: 'assets',
        value: [...activeAccount.assets, web3Token],
      })
    );
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
