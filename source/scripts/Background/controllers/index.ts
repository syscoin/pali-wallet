import omit from 'lodash/omit';
import { browser, Windows } from 'webextension-polyfill-ts';

import {
  accountType,
  IKeyringAccountState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';

import { persistor, RootState } from 'state/store';
import store from 'state/store';
import { IPersistState } from 'state/types';
import { IVaultState } from 'state/vault/types';
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
  createPopup: (route?: string, data?: object) => Promise<Windows.Window>;
  dapp: Readonly<IDAppController>;
  refresh: (silent?: boolean) => Promise<void>;
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
      console.log('rehydrated', rehydrated);
      initializeMainController();
    }
  });
  const initializeMainController = () => {
    console.log('Initializing main controller');
    console.log('Pali vault state: ', store.getState().vault);
    const walletState = vaultToWalletState(store.getState().vault);
    console.log('wallet state: ', walletState);
    dapp = Object.freeze(DAppController());
    wallet = Object.freeze(MainController(walletState));
    utils = Object.freeze(ControllerUtils());
    console.log('utils: ', utils);
    console.log('wallet: ', wallet);
    wallet.setStorage(window.localStorage);
    readyCallback({ appRoute, createPopup, dapp, refresh, utils, wallet });
  };

  const refresh = async (silent?: boolean) => {
    const { activeAccount, accounts } = store.getState().vault;
    if (!accounts[activeAccount.type][activeAccount.id].address) return;
    //TODO: Refactor refresh
    // await wallet.account.sys.getLatestUpdate(silent);
    // wallet.account.sys.watchMemPool();
    utils.setFiat();
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
    utils,
    wallet,
  };
};

export default MasterController;
