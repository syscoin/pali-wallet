import WalletController from './WalletController';
import ControllerUtils from './ControllerUtils';
import ConnectionsController from './ConnectionsController';
import MessagesController from './MessagesController';

export interface IMasterController {
  appRoute: (newRoute?: string) => string;
  connections: Readonly<IConnectionsController>;
  stateUpdater: () => void;
  wallet: Readonly<IWalletController>;
  messages: Readonly<IMessagesController>
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connections = Object.freeze(ConnectionsController());
  const messages = Object.freeze(MessagesController());

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    connections,
    appRoute: utils.appRoute,
    stateUpdater,
    messages
  };
};

export default MasterController;
