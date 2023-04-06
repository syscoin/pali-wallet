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
  refresh: () => void;
  updateNativeBalanceAfterSend: () => void;

  utils: Readonly<IControllerUtils>;
  wallet: Readonly<IMainController>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(MainController());
  const utils = Object.freeze(ControllerUtils());
  const dapp = Object.freeze(DAppController());

  const refresh = () => {
    const { activeAccount, accounts } = store.getState().vault;
    //We really need this validation ?
    if (!accounts[activeAccount].address) return;

    wallet.getLatestUpdateForCurrentAccount();
    utils.setFiat();
  };

  const updateNativeBalanceAfterSend = () => {
    setTimeout(() => {
      wallet.updateUserNativeBalance();
    }, 3500); // Wait some seconds to can fetch and get actual balance ( probaly will work only in EVM, UTX0 get a lot of time to update RPC values)
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
    updateNativeBalanceAfterSend,
    utils,
    wallet,
  };
};

export default MasterController;
