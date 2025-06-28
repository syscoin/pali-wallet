import { ethers } from 'ethers';

import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';

import { IEvmBalanceController } from './types';

const EvmBalanceController = (
  web3Provider: CustomJsonRpcProvider | CustomL2JsonRpcProvider
): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (
    currentAccount: IKeyringAccountState
  ) => {
    try {
      const provider = web3Provider;

      const getBalance = await provider.getBalance(currentAccount.address);

      // Always return the full precision balance as a string
      // Formatting for display should happen in the UI components
      const fullPrecisionBalance = ethers.utils.formatEther(getBalance);

      return fullPrecisionBalance;
    } catch (error) {
      console.error('[EvmBalanceController] Failed to fetch balance:', error);
      throw error;
    }
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
