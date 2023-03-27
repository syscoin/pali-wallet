import { browser, Windows } from 'webextension-polyfill-ts';

import store from 'state/store';
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
  wallet: Readonly<IMainController>;
}

const MasterController = (): IMasterController => {
  const vaultState = store.getState().vault;
  // const sysweb3Vault = Omit<IvaultState //TODO: omit information that's not used by sysweb3Vault
  // const wallet = Object.freeze(MainController(sysweb3Vault)); // TODO: initialise vault from our pali redux vault
  const wallet = Object.freeze(MainController());
  const utils = Object.freeze(ControllerUtils());
  const dapp = Object.freeze(DAppController());

  const refresh = async (silent?: boolean) => {
    const { activeAccount, accounts } = store.getState().vault;
    if (!accounts[activeAccount].address) return;

    await wallet.account.sys.getLatestUpdate(silent);
    wallet.account.sys.watchMemPool();
    utils.setFiat();
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
