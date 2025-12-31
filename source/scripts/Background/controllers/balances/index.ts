import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';

import { getController } from 'scripts/Background';

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
        const getSysBalance =
          await SyscoinBalanceController().getSysBalanceForAccount(
            currentAccount,
            networkUrl
          );
        return getSysBalance;

      case false:
        // Always pull the latest provider at call time (prevents stale references across network switches)
        const web3Provider =
          getController().wallet.ethereumTransaction.web3Provider;
        if (!web3Provider) {
          console.error(
            '[BalancesManager] No web3 provider available for EVM balance fetch'
          );
          return '0';
        }

        // Create EVM controller fresh with current provider
        const evmController = EvmBalanceController(web3Provider);
        const getEvmBalance = await evmController.getEvmBalanceForAccount(
          currentAccount
        );
        return getEvmBalance;
    }
  };

  return {
    sys: SyscoinBalanceController(),
    utils: {
      getBalanceUpdatedForAccount,
    },
  };
};

export default BalancesManager;
