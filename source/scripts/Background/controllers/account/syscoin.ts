import {
  IKeyringAccountState,
  SyscoinHDSigner,
  SyscoinMainSigner,
} from '@pollum-io/sysweb3-utils';

import { SysTransactionController } from '../transaction';
import SysTrezorController from '../trezor/syscoin';

const SysAccountController = ({
  hd,
  main,
}: {
  hd: SyscoinHDSigner;
  main: SyscoinMainSigner;
}) => {
  const trezor = SysTrezorController();
  const tx = SysTransactionController({ main });

  /** check if there is no pending transaction in mempool
   *  and get the latest update for account
   */
  const watchMemPool = (currentAccount: IKeyringAccountState | undefined) => {
    // 30 seconds - 3000 milliseconds
    const interval = 30 * 1000;

    const intervalId = setInterval(() => {
      tx.getLatestUpdate();

      if (!currentAccount || !currentAccount?.transactions) {
        clearInterval(intervalId);

        return false;
      }
    }, interval);

    return true;
  };

  /** get new receiving address passing true to skip increment,
   *  this way we always receive a new unused and valid address for
   *  each transaction
   */
  const setAddress = () => hd.getNewReceivingAddress(true);

  return {
    watchMemPool,
    trezor,
    tx,
    setAddress,
  };
};

export default SysAccountController;
