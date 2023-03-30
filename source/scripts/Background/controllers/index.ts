import omit from 'lodash/omit';
import { browser, Windows } from 'webextension-polyfill-ts';

import {
  accountType,
  IKeyringAccountState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';

import store from 'state/store';
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

const MasterController = (): IMasterController => {
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

    const wallet: IWalletState = {
      accounts,
      activeAccountId: vaultState.activeAccount.id,
      activeAccountType: vaultState.activeAccount.type,
      networks: vaultState.networks,
      activeNetwork: vaultState.activeNetwork,
    };
    const activeChain: INetworkType = vaultState.activeChain;

    return { wallet, activeChain };
  };
  const walletState = vaultToWalletState(store.getState().vault);
  console.log('Checking wallet State', walletState);
  const wallet = Object.freeze(MainController(walletState));
  const utils = Object.freeze(ControllerUtils());
  const dapp = Object.freeze(DAppController());

  const refresh = async (silent?: boolean) => {
    const { activeAccount, accounts } = store.getState().vault;
    if (!accounts[activeAccount.type][activeAccount.id].address) return;
    //TODO: Refactor refresh
    // await wallet.account.sys.getLatestUpdate(silent);
    // wallet.account.sys.watchMemPool();
    // utils.setFiat();
  };
  /**
   * Creates a popup for external routes. Mostly for DApps
   * @returns the window object from the popup
   */
  const createPopup = async (route = '', data = {}) => {
    const window = await browser.windows.getCurrent();

    if (!window || !window.width) return;

    const params = new URLSearchParams();
    if (route) params.append('route', route);
    if (data) params.append('data', JSON.stringify(data));

    return browser.windows.create({
      url: '/external.html?' + params.toString(),
      width: 400,
      height: 620,
      type: 'popup',
    });
  };

  return {
    appRoute: utils.appRoute,
    createPopup,
    dapp,
    refresh,
    utils,
    wallet,
  };
};

export default MasterController;
