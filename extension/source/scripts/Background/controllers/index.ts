import WalletController from './WalletController';
import ControllerUtils from './ControllerUtils';
import ConnectionsController from './ConnectionsController';
import CoingeckoController from './CoingeckoController';
export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  connections: Readonly<any>;
  stateUpdater: () => void;
  wallet: Readonly<IWalletController>;
  Coingecko: ICoingeckoController
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connectionsPrototype = Object.create(ConnectionsController);
  const Coingecko = CoingeckoController()

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    connections: Object.freeze(connectionsPrototype),
    appRoute: utils.appRoute,
    stateUpdater,
    Coingecko
  };
};

export default MasterController;
