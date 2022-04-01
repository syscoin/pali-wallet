import store from 'state/store';
import { SyscoinHDSigner } from '@pollum-io/sysweb3-utils';
import { Web3Accounts } from '@pollum-io/sysweb3-keyring';

import SysAccountController from './syscoin';

const WalletController = (data: {
  checkPassword: (pwd: string) => boolean;
  hd: SyscoinHDSigner;
  main: any;
}): { account: any; addAccount: any } => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    account: isSyscoinNetwork ? SysAccountController(data) : Web3Accounts(),
  };

  const addAccount = () => {};

  return { ...controller, addAccount };
};

export default WalletController;
