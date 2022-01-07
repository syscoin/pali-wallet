/* eslint-disable*/
import WalletController from './WalletController';
import ControllerUtils, { IControllerUtils } from './ControllerUtils';
import ConnectionsController from './ConnectionsController';
import { IWalletController } from 'types/controllers';

export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  connections: Readonly<any>;
  createPopup: any;
  dapp: any;
  stateUpdater: () => void;
  wallet: Readonly<IWalletController>;
  utils: Readonly<IControllerUtils>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connectionsPrototype = Object.create(ConnectionsController);
  const createPopup: any = []
  const dapp: any = []
  

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    createPopup,
    dapp,
    wallet,
    connections: Object.freeze(connectionsPrototype),
    appRoute: utils.appRoute,
    utils,
    stateUpdater,
  };
};

export default MasterController;
