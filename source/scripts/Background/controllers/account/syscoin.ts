import {
  KeyringManager,
  ISyscoinTransactions,
} from '@pollum-io/sysweb3-keyring';

import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import {
  setAccounts,
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';

export interface ISysAccountController {
  getLatestUpdate: (silent?: boolean) => Promise<void>;
  setAddress: () => Promise<string>;
  trezor: ISysTrezorController;
  tx: ISyscoinTransactions;
  watchMemPool: () => void;
}

const SysAccountController = (): ISysAccountController => {
  const keyringManager = KeyringManager();

  // id for `watchMemPool` setInterval
  let intervalId: NodeJS.Timer;

  const getLatestUpdate = async (silent?: boolean) => {
    const { activeAccount, activeNetwork, networks } = store.getState().vault;

    if (!activeAccount.address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    const { accountLatestUpdate, walleAccountstLatestUpdate } =
      await keyringManager.getLatestUpdateForAccount();

    store.dispatch(setIsPendingBalances(false));

    const isSyscoinChain =
      networks.syscoin[activeNetwork.chainId] &&
      activeNetwork.url.includes('blockbook');

    const hash = isSyscoinChain ? 'txid' : 'hash';
    const assetId = isSyscoinChain ? 'assetGuid' : 'id';

    const filteredTxs = accountLatestUpdate.transactions.filter(
      (tx: any) =>
        !activeAccount.transactions.some(
          (transaction: any) => transaction[hash] === tx[hash]
        )
    );

    const filteredAssets = accountLatestUpdate.assets.filter(
      (latestUpdateAsset: any) =>
        !activeAccount.assets.some(
          (asset: any) => latestUpdateAsset[assetId] === asset[assetId]
        )
    );

    const currentAccount = {
      ...activeAccount,
      ...accountLatestUpdate,
      transactions: [...activeAccount.transactions, ...filteredTxs],
      assets: [...activeAccount.assets, ...filteredAssets],
    };

    store.dispatch(setActiveAccount(currentAccount));

    store.dispatch(
      setAccounts({
        ...walleAccountstLatestUpdate,
        [currentAccount.id]: currentAccount,
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

  const trezor = SysTrezorController();
  const tx = keyringManager.txs;

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
    getLatestUpdate,
  };
};

export default SysAccountController;
