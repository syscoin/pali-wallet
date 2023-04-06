import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import EvmBalanceController from './evm';
import SyscoinBalanceController from './syscoin';
import { IBalancesManager } from './types';

const BalancesManager = (): IBalancesManager => {
  const getBalanceUpdatedForAccount = async (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    networkUrl: string
  ) => {
    switch (isBitcoinBased) {
      case true:
        try {
          const getSysBalance =
            await SyscoinBalanceController().getSysBalanceForAccount(
              currentAccount.xpub,
              networkUrl
            );

          return getSysBalance;
        } catch (sysBalanceError) {
          return sysBalanceError;
        }
      case false:
        try {
          const getEvmBalance =
            await EvmBalanceController().getEvmBalanceForAccount(
              currentAccount.address,
              networkUrl
            );

          return getEvmBalance;
        } catch (evmBalanceError) {
          return evmBalanceError;
        }
    }
  };

  return {
    evm: EvmBalanceController(),
    sys: SyscoinBalanceController(),
    utils: {
      getBalanceUpdatedForAccount,
    },
  };
};

export default BalancesManager;
