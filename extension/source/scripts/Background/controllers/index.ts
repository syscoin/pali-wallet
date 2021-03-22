import WalletController, { IWalletController } from './WalletController';
import ControllerUtils from './ControllerUtils';
import ContactsController, { IContactsController } from './ContactsController';
export interface IMasterController {
  wallet: Readonly<IWalletController>;
  contacts: Readonly<IContactsController>;
  stateUpdater: () => void;
  appRoute: (newRoute?: string) => string;
}

const MasterController = (): IMasterController => {
  const wallet = Object.freeze(WalletController());
  const utils = Object.freeze(ControllerUtils());
  const contacts = Object.freeze(
    ContactsController({ isLocked: wallet.isLocked })
  );

  const stateUpdater = () => {
    utils.updateFiat();
  };

  return {
    wallet,
    contacts,
    appRoute: utils.appRoute,
    stateUpdater,
  };
};

export default MasterController;
