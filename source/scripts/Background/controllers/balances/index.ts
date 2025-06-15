import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
} from '@pollum-io/sysweb3-keyring';

import { IPaliAccount } from 'state/vault/types';

import EvmBalanceController from './evm';
import SyscoinBalanceController from './syscoin';
import { IBalancesManager } from './types';

const BalancesManager = (): IBalancesManager => {
  const getBalanceUpdatedForAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    networkUrl: string,
    provider?: CustomJsonRpcProvider | CustomL2JsonRpcProvider
  ) => {
    switch (isBitcoinBased) {
      case true:
        try {
          const getSysBalance =
            await SyscoinBalanceController().getSysBalanceForAccount(
              currentAccount,
              networkUrl
            );

          return getSysBalance;
        } catch (sysBalanceError) {
          return sysBalanceError;
        }
      case false:
        try {
          if (!provider) {
            console.error('No valid web3Provider for EVM balance fetching');
            return '0';
          }

          // Create EVM controller fresh with current provider
          const evmController = EvmBalanceController(provider);
          const getEvmBalance = await evmController.getEvmBalanceForAccount(
            currentAccount
          );

          return getEvmBalance;
        } catch (evmBalanceError) {
          return evmBalanceError;
        }
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
