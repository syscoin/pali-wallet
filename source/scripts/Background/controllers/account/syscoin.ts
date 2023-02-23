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
import { ITokenSysProps } from 'types/tokens';
import { getBalanceUpdatedToErcTokens } from 'utils/tokens';

export interface ISysAccountController {
  getLatestUpdate: (silent?: boolean) => Promise<void>;
  saveTokenInfo: (token: ITokenSysProps) => Promise<void>;
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
    const accountId = activeAccount;
    if (!accounts[accountId].address) return;

    if (!silent) store.dispatch(setIsPendingBalances(true));

    store.dispatch(setIsLoadingTxs(true));
    const { walleAccountstLatestUpdate } =
      await keyringManager.getLatestUpdateForAccount();
    store.dispatch(setIsPendingBalances(false));

    const hash = isBitcoinBased ? 'txid' : 'hash';

    store.dispatch(setIsLoadingTxs(false));

    const formattedWalletAccountsLatestUpdates = Object.assign(
      {},
      await Promise.all(
        Object.values(walleAccountstLatestUpdate).map(
          async (account: any, index) => {
            const { transactions: updatedTxs } = account;

            const allTxs = [
              ...accounts[index].transactions,
              ...updatedTxs,
            ].filter(
              (value, i, self) =>
                i ===
                self.findIndex((tx) => tx && value && tx[hash] === value[hash])
            ); // to get array with unique txs.

            if (isBitcoinBased)
              return {
                ...account,
                label: accounts[index].label,
                transactions: [...allTxs],
                assets: {
                  ethereum: accounts[index].assets.ethereum,
                  syscoin: account.assets,
                },
              };
            else {
              //UPDATE ETH ERC TOKEN BALANCES
              const getUpdatedErcTokens = await getBalanceUpdatedToErcTokens(
                accounts[index].id
              );

              return {
                ...account,
                label: accounts[index].label,
                assets: {
                  syscoin: accounts[index].assets.syscoin,
                  ethereum: getUpdatedErcTokens,
                },
                transactions: [...allTxs],
              };
            }
          }
        )
      )
    );

    store.dispatch(
      setAccounts({
        ...formattedWalletAccountsLatestUpdates,
      })
    );

    store.dispatch(setAccounts({ ...formattedWalletAccountsLatestUpdates }));

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
      const { activeAccount, accounts } = store.getState().vault;

      if (
        !accounts[activeAccount].address ||
        !accounts[activeAccount].transactions
      ) {
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

  const saveTokenInfo = async (token: ITokenSysProps) => {
    try {
      const { activeAccount, accounts } = store.getState().vault;

      const tokenExists = accounts[activeAccount].assets.find(
        (asset: ITokenSysProps) => asset.assetGuid === token.assetGuid
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
          value: [...accounts[activeAccount].assets, asset],
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
