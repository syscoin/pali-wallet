import { formatEther } from '@ethersproject/units';
import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';

import { IEvmBalanceController } from './types';

const EvmBalanceController = (
  web3Provider: CustomJsonRpcProvider
): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (
    currentAccount: IKeyringAccountState
  ) => {
    const provider = web3Provider;
    if (!provider) {
      console.error(
        '[EvmBalanceController] Missing provider in getEvmBalanceForAccount'
      );
      return '0';
    }

    const getBalance = await provider.getBalance(currentAccount.address);

    // Always return the full precision balance as a string
    // Formatting for display should happen in the UI components
    const fullPrecisionBalance = formatEther(getBalance);

    return fullPrecisionBalance;
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
