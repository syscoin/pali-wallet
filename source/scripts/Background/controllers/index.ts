import ControllerUtils, { IControllerUtils } from './ControllerUtils';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  stateUpdater: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: Readonly<any>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(MainController());
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
