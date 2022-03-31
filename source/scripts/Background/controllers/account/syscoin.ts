import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';
import { SysTransactionController } from '../transaction';
import SysTrezorController from '../trezor/syscoin';

const SysAccountController = (data) => {
  const trezor = SysTrezorController();
  const tx = SysTransactionController(data);

  const addAccount = () => {};

  const watchMemPool = (currentAccount: IKeyringAccountState | undefined) => {
    // 30 seconds
    const intervalInMs = 30 * 1000;

    const intervalId = setInterval(() => {
      tx.getLatestUpdate();

      if (!currentAccount || !currentAccount?.transactions) {
        clearInterval(intervalId);

        return false;
      }
    }, intervalInMs);

    return true;
  };

  return {
    addAccount,
    watchMemPool,
    trezor,
    tx,
  };
};

export default SysAccountController;
