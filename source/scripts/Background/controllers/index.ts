import { IWalletController } from 'types/controllers';

import WalletController from './WalletController';
import ControllerUtils, { IControllerUtils } from './ControllerUtils';

export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  stateUpdater: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: Readonly<IWalletController>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    appRoute: utils.appRoute,
    utils,
    stateUpdater,
  };
};

export default MasterController;
