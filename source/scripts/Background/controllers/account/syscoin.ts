import axios from 'axios';
import { resolve } from 'path';

import {
  KeyringManager,
  ISyscoinTransactions,
  SyscoinTransactions,
} from '@pollum-io/sysweb3-keyring';

import { PaliEvents, PaliSyscoinEvents } from '../message-handler/types';
import SysTrezorController, { ISysTrezorController } from '../trezor/syscoin';
import store from 'state/store';
import {
  setAccounts,
  setActiveAccountProperty,
  setIsLoadingTxs,
  setIsNetworkChanging,
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
    const { activeAccount, isBitcoinBased, accounts, activeNetwork } =
      store.getState().vault;
    const { id: accountId } = activeAccount;
    if (!accounts[accountId].address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    store.dispatch(setIsLoadingTxs(true));

    const { accountLatestUpdate, walleAccountstLatestUpdate } =
      await keyringManager.getLatestUpdateForAccount(); //TODO: validate whats breaking on this function
    //TODO: after calling createToken from syscoin UTXO getLatestUpdate breaks and gets to a infinite loop with setPendingTxs
    store.dispatch(setIsPendingBalances(false));

    const hash = isBitcoinBased ? 'txid' : 'hash';

    const { address, balances, xpub, assets } = accountLatestUpdate;

    const transactions = [
      ...accountLatestUpdate.transactions,
      ...accounts[accountId].transactions,
    ];

    const filteredTxs = transactions.filter(
      (value, index, self) =>
        index === self.findIndex((tx) => tx[hash] === value[hash])
    );

    store.dispatch(
      setActiveAccountProperty({
        property: 'transactions',
        value: [...filteredTxs],
      })
    );

    store.dispatch(setIsLoadingTxs(false));

    store.dispatch(
      setActiveAccountProperty({
        property: 'address',
        value: address,
      })
    );

    store.dispatch(
      setActiveAccountProperty({
        property: 'balances',
        value: balances,
      })
    );

    store.dispatch(
      setActiveAccountProperty({
        property: 'xpub',
        value: xpub,
      })
    );

    if (isBitcoinBased) {
      store.dispatch(
        setActiveAccountProperty({
          property: 'assets',
          value: { ...accounts[accountId].assets, syscoin: assets },
        })
      );
    }

    const formattedWalletAccountsLatestUpdates = Object.assign(
      {},
      Object.values(walleAccountstLatestUpdate).map((account: any, index) => {
        const { transactions: updatedTxs } = account;

        const allTxs = [...accounts[index].transactions, ...updatedTxs].filter(
          (value, i, self) =>
            i === self.findIndex((tx) => tx[hash] === value[hash])
        ); // to get array with unique txs.

        if (index === accountId) {
          if (isBitcoinBased)
            return {
              ...account,
              label: accounts[index].label,
              transactions: [...filteredTxs],
              assets: {
                ethereum: accounts[index].assets.ethereum,
                syscoin: account.assets,
              },
            };
          else
            return {
              ...account,
              label: accounts[index].label,
              assets: accounts[index].assets,
              transactions: [...filteredTxs],
            };
        }
        if (isBitcoinBased)
          return {
            ...account,
            label: accounts[index].label,
            transactions: [...filteredTxs],
            assets: {
              ethereum: accounts[index].assets.ethereum,
              syscoin: account.assets,
            },
          };
        else
          return {
            ...account,
            label: accounts[index].label,
            assets: accounts[index].assets,
            transactions: [...allTxs],
          };
      })
    );

    store.dispatch(
      setAccounts({
        ...formattedWalletAccountsLatestUpdates,
      })
    );
    resolve();

    const isUpdating = store.getState().vault.isNetworkChanging;
    window.controller.dapp.handleBlockExplorerChange(
      PaliSyscoinEvents.blockExplorerChanged,
      {
        method: PaliSyscoinEvents.blockExplorerChanged,
        params: isBitcoinBased ? activeNetwork.url : null,
      }
    );
    if (!isUpdating)
      window.controller.dapp.handleStateChange(PaliEvents.chainChanged, {
        method: PaliEvents.chainChanged,
        params: {
          chainId: `0x${activeNetwork.chainId.toString(16)}`,
          networkVersion: activeNetwork.chainId,
        },
      });
    else store.dispatch(setIsNetworkChanging(false));
  };

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = () => {
    if (intervalId) clearInterval(intervalId);
    //TODO: this should be enhanced and its only being set after user refresh the wallet
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
