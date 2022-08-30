import axios from 'axios';

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
  saveTokenInfo: (token: any) => Promise<void>;
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
    const assetId = isSyscoinChain ? 'assetGuid' : 'contractAddress';

    const transactions = [
      ...accountLatestUpdate.assets,
      ...store.getState().vault.activeAccount.assets,
    ];

    const filteredTxs = transactions.filter(
      (value, index, self) =>
        index === self.findIndex((tx) => tx[hash] === value[hash])
    );

    const assets = [
      ...accountLatestUpdate.assets,
      ...store.getState().vault.activeAccount.assets,
    ];

    const filteredAssets = assets.filter(
      (value, index, self) =>
        index === self.findIndex((asset) => asset[assetId] === value[assetId])
    );

    const currentAccount = {
      ...activeAccount,
      ...accountLatestUpdate,
      transactions: [...activeAccount.transactions, ...filteredTxs],
      assets: filteredAssets,
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

  const saveTokenInfo = async (token: any) => {
    try {
      const { activeAccount } = store.getState().vault;

      const tokenExists = activeAccount.assets.find(
        (asset: any) => asset.assetGuid === token.assetGuid
      );

      if (tokenExists) throw new Error('Token already exists');

      const description =
        token.pubData && token.pubData.desc ? atob(token.pubData.desc) : '';

      const ipfsUrl = description.startsWith('https://ipfs.io/ipfs/')
        ? description
        : '';

      const { data } = await axios.get(ipfsUrl);

      const image = data && data.image ? data.image : '';

      const asset = {
        ...token,
        description,
        image,
        balance: Number(token.balance) / 10 ** Number(token.decimals),
      };

      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: [...activeAccount.assets, asset],
        })
      );
    } catch (error) {
      throw new Error(`Could not save token info. Error: ${error}`);
    }
  };

  const trezor = SysTrezorController();
  const tx = keyringManager.txs;

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
