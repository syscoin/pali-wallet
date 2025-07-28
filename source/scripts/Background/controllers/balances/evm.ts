import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';
import { ethers } from 'ethers';

import { IEvmBalanceController } from './types';

const EvmBalanceController = (
  web3Provider: CustomJsonRpcProvider | CustomL2JsonRpcProvider
): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (
    currentAccount: IKeyringAccountState
  ) => {
    const provider = web3Provider;

    const getBalance = await provider.getBalance(currentAccount.address);

    // Always return the full precision balance as a string
    // Formatting for display should happen in the UI components
    const fullPrecisionBalance = ethers.utils.formatEther(getBalance);

    return fullPrecisionBalance;
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
