import omit from 'lodash/omit';
import { browser, Windows } from 'webextension-polyfill-ts';

import {
  accountType,
  IKeyringAccountState,
  initialNetworksState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { persistor, RootState } from 'state/store';
import store from 'state/store';
import { IPersistState } from 'state/types';
import {
  setAccountPropertyByIdAndType,
  setAdvancedSettings,
  setNetworks,
} from 'state/vault';
import { IVaultState, TransactionsType } from 'state/vault/types';
import {
  IControllerUtils,
  IDAppController,
  IMainController,
} from 'types/controllers';

import ControllerUtils from './ControllerUtils';
import DAppController from './DAppController';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string, external?: boolean) => string;
  callGetLatestUpdateForAccount: () => void;
  createPopup: (route?: string, data?: object) => Promise<Windows.Window>;
  dapp: Readonly<IDAppController>;
  refresh: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: IMainController;
}

const MasterController = (
  readyCallback: (windowController: any) => void
): IMasterController => {
  let route = '/';
  let externalRoute = '/';
  let wallet: IMainController;
  let utils: Readonly<IControllerUtils>;
  let dapp: Readonly<IDAppController>;
  const vaultToWalletState = (vaultState: IVaultState) => {
    const accounts: { [key in KeyringAccountType]: accountType } =
      Object.entries(vaultState.accounts).reduce(
        (acc, [sysAccountType, paliAccountType]) => {
          acc[sysAccountType as KeyringAccountType] = Object.fromEntries(
            Object.entries(paliAccountType).map(([accountId, paliAccount]) => {
              const keyringAccountState: IKeyringAccountState = omit(
                paliAccount,
                ['assets', 'transactions']
              ) as IKeyringAccountState;
              return [accountId, keyringAccountState];
            })
          );
          return acc;
        },
        {} as { [key in KeyringAccountType]: accountType }
      );

    const sysweb3Wallet: IWalletState = {
      accounts,
      activeAccountId: vaultState.activeAccount.id,
      activeAccountType: vaultState.activeAccount.type,
      networks: vaultState.networks,
      activeNetwork: vaultState.activeNetwork,
    };
    const activeChain: INetworkType = vaultState.activeChain;

    return { wallet: sysweb3Wallet, activeChain };
  };
  // Subscribe to store updates
  persistor.subscribe(() => {
    const state = store.getState() as RootState & { _persist: IPersistState };
    const {
      _persist: { rehydrated },
    } = state;
    if (rehydrated) {
      initializeMainController();
    }
  });
  const initializeMainController = () => {
    if (!store.getState().vault.networks[TransactionsType.Ethereum][570]) {
      store.dispatch(
        setNetworks({
          chain: 'ethereum' as INetworkType,
          network: {
            chainId: 570,
            currency: 'sys',
            default: true,
            label: 'Rollux',
            url: 'https://rpc.rollux.com',
            apiUrl: 'https://explorer.rollux.com/api',
            explorer: 'https://explorer.rollux.com/',
          } as INetwork,
          isEdit: false,
        })
      );
    }

    const isNetworkOldState =
      store.getState()?.vault?.networks?.[TransactionsType.Ethereum][1]
        ?.default ?? false;

    if (isNetworkOldState) {
      Object.values(initialNetworksState[TransactionsType.Ethereum]).forEach(
        (network) => {
          store.dispatch(
            setNetworks({
              chain: 'ethereum' as INetworkType,
              network: network as INetwork,
              isEdit: false,
              isFirstTime: true,
            })
          );
        }
      );
    }
    if (store.getState().vault?.advancedSettings === undefined) {
      store.dispatch(
        setAdvancedSettings({
          advancedProperty: 'refresh',
          isActive: false,
          isFirstTime: true,
        })
      );
    }

    const hdAccounts = Object.values(store.getState().vault.accounts.HDAccount);
    const trezorAccounts = Object.values(
      store.getState().vault.accounts.Trezor
    );
    const importedAccounts = Object.values(
      store.getState().vault.accounts.Imported
    );

    const accountsObj = [...hdAccounts, ...trezorAccounts, ...importedAccounts];
    const isBitcoinBased = store.getState()?.vault?.isBitcoinBased;

    const isTransactionsOldState = accountsObj.some((account) =>
      Array.isArray(account.transactions)
    );

    if (isTransactionsOldState) {
      const {
        activeNetwork: { chainId },
      } = store.getState().vault;

      accountsObj.forEach((account) => {
        const accType = (
          !account.isImported && !account.isTrezorWallet
            ? 'HDAccount'
            : account.isTrezorWallet
            ? 'Trezor'
            : 'Imported'
        ) as KeyringAccountType;

        if (Array.isArray(account.transactions)) {
          if (account.transactions.length > 0) {
            const updatedTransactions = {
              syscoin: {},
              ethereum: {},
            } as { [chainType: string]: { [chainId: string]: any } };

            account.transactions.forEach((tx) => {
              const currentNetwork = isBitcoinBased ? 'syscoin' : 'ethereum';
              const currentChainId = isBitcoinBased ? chainId : tx.chainId;

              updatedTransactions[currentNetwork][currentChainId] = [
                ...(updatedTransactions[currentNetwork]?.[currentChainId] ??
                  []),
                tx,
              ];
            });

            store.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: updatedTransactions,
              })
            );
          } else {
            store.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: {
                  syscoin: {},
                  ethereum: {},
                },
              })
            );
          }
        }
      });
    }
    const walletState = vaultToWalletState(store.getState().vault);
    dapp = Object.freeze(DAppController());
    wallet = Object.freeze(MainController(walletState));
    utils = Object.freeze(ControllerUtils());
    wallet.setStorage(window.localStorage);
    readyCallback({
      appRoute,
      createPopup,
      dapp,
      refresh,
      utils,
      wallet,
      callGetLatestUpdateForAccount,
    });
  };

  const callGetLatestUpdateForAccount = () =>
    wallet.getLatestUpdateForCurrentAccount();

  const refresh = () => {
    const { activeAccount, accounts } = store.getState().vault;
    if (!accounts[activeAccount.type][activeAccount.id].address) return;
    callGetLatestUpdateForAccount();
  };

  /**
   * Determine which is the app route
   * @returns the proper route
   */
  const appRoute = (newRoute?: string, external = false) => {
    if (newRoute) {
      if (external) externalRoute = newRoute;
      else route = newRoute;
    }
    return external ? externalRoute : route;
  };

  /**
   * Creates a popup for external routes. Mostly for DApps
   * @returns the window object from the popup
   */
  const createPopup = async (popUpRoute = '', data = {}) => {
    const window = await browser.windows.getCurrent();

    if (!window || !window.width) return;

    const params = new URLSearchParams();
    if (popUpRoute) params.append('route', popUpRoute);
    if (data) params.append('data', JSON.stringify(data));

    return browser.windows.create({
      url: '/external.html?' + params.toString(),
      width: 400,
      height: 620,
      type: 'popup',
    });
  };

  return {
    appRoute,
    createPopup,
    dapp,
    refresh,
    callGetLatestUpdateForAccount,
    utils,
    wallet,
  };
};

export default MasterController;
