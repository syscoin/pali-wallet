import WalletController, { IWalletController } from './WalletController';
import ControllerUtils from './ControllerUtils';
import ConnectionsController, { IConnectionsController } from './ConnectionsController';
export interface IMasterController {
  wallet: Readonly<IWalletController>;
  connections: Readonly<IConnectionsController>;
  stateUpdater: () => Promise<void>;
  appRoute: (newRoute?: string) => string;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connections = Object.freeze(ConnectionsController());


  const stateUpdater = async () => {
    await utils.updateFiat();
  };

  return {
    wallet,
    connections,
    appRoute: utils.appRoute,
    stateUpdater,
  };
};

export default MasterController;
