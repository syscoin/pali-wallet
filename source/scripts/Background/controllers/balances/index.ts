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
  // Defer creation of EVM controller until needed
  let evmBalanceController: any = null;

  const getEvmController = () => {
    if (!evmBalanceController && web3Provider) {
      evmBalanceController = EvmBalanceController(web3Provider);
    }
    return evmBalanceController;
  };

  const getBalanceUpdatedForAccount = async (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    networkUrl: string
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
          const getEvmBalance =
            await getEvmController().getEvmBalanceForAccount(currentAccount);

          return getEvmBalance;
        } catch (evmBalanceError) {
          return evmBalanceError;
        }
    }
  };

  return {
    evm: getEvmController(), // Return the controller (may be null for UTXO networks)
    sys: SyscoinBalanceController(),
    utils: {
      getBalanceUpdatedForAccount,
    },
  };
};

export default BalancesManager;
