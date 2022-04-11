import store from 'state/store';
import { Web3Accounts, KeyringManager } from '@pollum-io/sysweb3-keyring';

import SysAccountController from './syscoin';

const WalletController = (): { account: any; addAccount: any } => {
  const keyringManager = KeyringManager();

  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    account: isSyscoinNetwork ? SysAccountController() : Web3Accounts(),
  };

  const addAccount = async (label: string) =>
    keyringManager.addNewAccount(label);

  return { ...controller, addAccount };
};

export default WalletController;
