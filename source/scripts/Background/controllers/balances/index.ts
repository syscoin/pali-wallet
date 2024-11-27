import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
} from '@pollum-io/sysweb3-keyring';

import { IPaliAccount } from 'state/vault/types';

import EvmBalanceController from './evm';
import SyscoinBalanceController from './syscoin';
import { IBalancesManager } from './types';

const BalancesManager = (
  web3Provider: CustomJsonRpcProvider | CustomL2JsonRpcProvider
): IBalancesManager => {
  const evmBalanceController = EvmBalanceController(web3Provider);
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
          const getEvmBalance = await EvmBalanceController(
            provider || web3Provider
          ).getEvmBalanceForAccount(currentAccount);

          return getEvmBalance;
        } catch (evmBalanceError) {
          return evmBalanceError;
        }
    }
  };

  return {
    evm: evmBalanceController,
    sys: SyscoinBalanceController(),
    utils: {
      getBalanceUpdatedForAccount,
    },
  };
};

export default BalancesManager;
