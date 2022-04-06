import store from 'state/store';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

import SysAccountController from './syscoin';

const WalletController = (): { account: any; addAccount: any } => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    account: isSyscoinNetwork ? SysAccountController() : Web3Accounts(),
  };

  const addAccount = () => {};

  return { ...controller, addAccount };
};

export default WalletController;
