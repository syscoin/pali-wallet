import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import EvmBalanceController from './evm';
import SyscoinBalanceController from './syscoin';
import { IBalancesManager } from './types';

const BalancesManager = (): IBalancesManager => {
  const getBalanceUpdatedForAccount = async (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    networkUrl: string,
    provider: CustomJsonRpcProvider | CustomL2JsonRpcProvider
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
        if (!provider) {
          throw new Error('No valid web3Provider for EVM balance fetching');
        }

        // Create EVM controller fresh with current provider
        const evmController = EvmBalanceController(provider);
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
