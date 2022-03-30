import store from 'state/store';
import { fromZPub } from 'bip84';
import syscoin from 'syscoinjs-lib';
import { Assets, IAccountInfo, Transaction } from 'types/transactions';

import {
  EthTransactionController,
  SysTransactionController,
} from '../transaction';

import SysAccountController from './syscoin';
import { SyscoinHDSigner } from '@pollum-io/sysweb3-utils';
import SysTrezorController from '../trezor/syscoin';
import EthTrezorController from '../trezor/ethereum';
import EthAccountController from './ethereum';

export const CommonAccountController = ({ main }) => {
  return {};
};

const WalletController = (data: {
  hd: SyscoinHDSigner;
  main: any;
  checkPassword: (pwd: string) => boolean;
}): { account: any; trezor: any; tx: any } => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const controller = {
    ...CommonAccountController(data),
    trezor: isSyscoinNetwork
      ? SysTrezorController(data)
      : EthTrezorController(),
    tx: isSyscoinNetwork
      ? SysTransactionController()
      : EthTransactionController(),
    account: isSyscoinNetwork
      ? SysAccountController(data)
      : EthAccountController(data),
  };

  return controller;
};

export default WalletController;
