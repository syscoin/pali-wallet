import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

import SysAccountController from './syscoin';

const WalletController = (
  keyringManager: any
): { account: any; addAccount: any } => {
  const controller = {
    account: {
      sys: SysAccountController(),
      eth: Web3Accounts(),
    },
  };

  const addAccount = async (label: string) =>
    keyringManager.addNewAccount(label);

  return { ...controller, addAccount };
};

export default WalletController;
