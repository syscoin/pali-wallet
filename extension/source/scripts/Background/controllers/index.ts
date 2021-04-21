import WalletController, { IWalletController } from './WalletController';
import ControllerUtils from './ControllerUtils';
import ContactsController,  { IContactsController } from './ContactsController';
import ConnectionsController, { IConnectionsController } from './ConnectionsController';
export interface IMasterController {
  wallet: Readonly<IWalletController>;
  contacts: Readonly<IContactsController>;
  connections: Readonly<IConnectionsController>;
  stateUpdater: () => void;
  appRoute: (newRoute?: string) => string;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const connections = Object.freeze(ConnectionsController());
  const contacts = Object.freeze(
    ContactsController({ isLocked: wallet.isLocked })
  );

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    contacts,
    connections,
    appRoute: utils.appRoute,
    stateUpdater,
  };
};

export default MasterController;
