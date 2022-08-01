import { KeyringManager, Web3Accounts } from '@pollum-io/sysweb3-keyring';

import {
  ISysTransactionController,
  SysTransactionController,
} from '../transaction';
import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import {
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';

export interface ISysAccountController {
  getLatestUpdate: (silent?: boolean) => Promise<void>;
  saveTokenInfo: (token: any) => Promise<void>;
  setAddress: () => Promise<string>;
  trezor: ISysTrezorController;
  tx: ISysTransactionController;
  watchMemPool: () => void;
}

const SysAccountController = (): ISysAccountController => {
  const keyringManager = KeyringManager();

  // id for `watchMemPool` setInterval
  let intervalId: NodeJS.Timer;

  const getLatestUpdate = async (silent?: boolean) => {
    const { activeAccount, networks, activeNetwork } = store.getState().vault;

    if (!activeAccount.address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    const updatedAccountInfo = await keyringManager.getLatestUpdateForAccount();

    store.dispatch(setIsPendingBalances(false));

    const isSyscoinChain = Boolean(networks.syscoin[activeNetwork.chainId]);

    const { assets } = updatedAccountInfo;

    const storedAssets = activeAccount.assets.filter((asset: any) =>
      assets.filter(
        (activeAccountAsset: any) => activeAccountAsset.id !== asset.id
      )
    );

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        ...updatedAccountInfo,
        assets: isSyscoinChain ? assets : storedAssets,
      })
    );
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

  const getErc20TokenBalance = async (
    tokenAddress: string,
    walletAddress: string
  ) => {
    try {
      const balance = await Web3Accounts().getBalanceOfAnyToken(
        tokenAddress,
        walletAddress
      );

      console.log('balance any tok', balance);

      return balance;
    } catch (error) {
      return 0;
    }
  };

  const saveTokenInfo = async (token: any) => {
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
