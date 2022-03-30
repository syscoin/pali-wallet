import store from 'state/store';

import SysAccountController from './syscoin';
import { SyscoinHDSigner } from '@pollum-io/sysweb3-utils';
import EthAccountController from './ethereum';

const WalletController = (data: {
  hd: SyscoinHDSigner;
  main: any;
  checkPassword: (pwd: string) => boolean;
}): { account: any } => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    account: isSyscoinNetwork
      ? SysAccountController(data)
      : EthAccountController(),
  };

  return controller;
};

export default WalletController;
