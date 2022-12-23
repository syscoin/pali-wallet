import axios from 'axios';

import {
  KeyringManager,
  ISyscoinTransactions,
  SyscoinTransactions,
} from '@pollum-io/sysweb3-keyring';

import DAppController from '../DAppController';
import { DAppEvents } from '../message-handler/types';
import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import {
  setAccounts,
  setActiveAccount,
  setActiveAccountProperty,
  setIsPendingBalances,
} from 'state/vault';
import { removeXprv } from 'utils/account';

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
    const { activeAccount, isBitcoinBased, accounts } = store.getState().vault;

    const { id: accountId } = activeAccount;
    if (!accounts[accountId].address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    const response = await keyringManager.getLatestUpdateForAccount();

    if (!response.accountLatestUpdate)
      throw new Error('Could not get account info.');

    store.dispatch(setIsPendingBalances(false));

    const hash = isBitcoinBased ? 'txid' : 'hash';

    const { address, balances, xpub, xprv, assets } =
      response.accountLatestUpdate;

    const transactions = [
      ...response.accountLatestUpdate.transactions,
      ...accounts[accountId].transactions,
    ];

    const filteredTxs = transactions.filter(
      (value, index, self) =>
        index === self.findIndex((tx) => tx[hash] === value[hash])
    );

    store.dispatch(
      setActiveAccount({
        ...activeAccount,
        transactions: [...accounts[accountId].transactions, ...filteredTxs],
        address,
        balances,
        xpub,
        xprv,
        assets: isBitcoinBased
          ? { ...accounts[accountId].assets, syscoin: assets }
          : assets,
      })
    );

    // setAddress(); review

    const formattedWalletAccountsLatestUpdates = Object.assign(
      {},
      Object.values(response.walleAccountstLatestUpdate).map(
        (account: any, index) => ({
          ...account,
          assets: accounts[index].assets,
        })
      )
    );

    store.dispatch(
      setAccounts({
        ...formattedWalletAccountsLatestUpdates,
      })
    );

    DAppController().dispatchEvent(
      DAppEvents.accountUpdate,
      removeXprv(accounts[accountId])
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
  const tx = SyscoinTransactions();

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
