import { browser, Windows } from 'webextension-polyfill-ts';

import { IControllerUtils, IDAppController } from 'types/controllers';

import ControllerUtils from './ControllerUtils';
import DAppController from './DAppController';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string, external?: boolean) => string;
  createPopup: (
    windowId: string,
    network?: string,
    route?: string,
    data?: object
  ) => Promise<Windows.Window>;
  dapp: Readonly<IDAppController>;
  stateUpdater: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: Readonly<any>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(MainController());
  const utils = Object.freeze(ControllerUtils());
  const dapp = Object.freeze(DAppController());

  const stateUpdater = () => {
    utils.setFiat();
  };

  const createPopup = async (
    windowId,
    network = 'main',
    route = '',
    data = {}
  ) => {
    const _window = await browser.windows.getCurrent();

    if (!_window || !_window.width) return null;

    let url = '/external.html?';

    if (route) {
      url += `route=${route}&windowId=${windowId}&data=${JSON.stringify(
        data
      )}&network=${network}`;
    }

    return browser.windows.create({
      url,
      width: 372,
      height: 600,
      type: 'popup',
      top: 0,
      left: _window.width - 372,
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
