import WalletController from './WalletController';
import ControllerUtils from './ControllerUtils';
import ConnectionsController from './ConnectionsController';

export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  connections: Readonly<any>;
  stateUpdater: () => void;
  wallet: Readonly<IWalletController>;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connectionsPrototype = Object.create(ConnectionsController);

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    connections: Object.freeze(connectionsPrototype),
    appRoute: utils.appRoute,
    stateUpdater,
  };
};

export default MasterController;
