import { browser, Windows } from 'webextension-polyfill-ts';

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
  stateUpdater: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: Readonly<IMainController>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(MainController());
  const utils = Object.freeze(ControllerUtils());
  const dapp = Object.freeze(DAppController());

  const stateUpdater = () => {
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
      width: 372,
      height: 600,
      type: 'popup',
    });
  };

  return {
    appRoute: utils.appRoute,
    createPopup,
    dapp,
    stateUpdater,
    utils,
    wallet,
  };
};

export default MasterController;
