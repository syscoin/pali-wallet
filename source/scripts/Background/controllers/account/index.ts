import { IKeyringManager } from '@pollum-io/sysweb3-keyring';

import EthAccountController from './evm';
import SysAccountController from './syscoin';

const WalletController = (
  keyringManager: IKeyringManager
): { account: any; addAccount: any } => {
  const controller = {
    account: {
      sys: SysAccountController(),
      eth: EthAccountController(),
    },
  };

  const addAccount = async (label: string) =>
    keyringManager.addNewAccount(label);

  return { ...controller, addAccount };
};

export default WalletController;
