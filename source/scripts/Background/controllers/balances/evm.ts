import { ethers } from 'ethers';

import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { IEvmBalanceController } from './types';
import { zerosRepeatingAtStartOfEvmBalance } from './utils';

const EvmBalanceController = (): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (
    address: string,
    networkUrl: string
  ) => {
    try {
      //LATER CHANGE THIS TO USE NEW PROVIDER FROM SYSWEB3
      const provider = new ethers.providers.JsonRpcProvider(networkUrl);

      const getBalance = await provider.getBalance(address);

      const formattedBalance = ethers.utils.formatEther(getBalance);

      //Validate quantity of zeros in the start of balance to don't how a big 0 decimal number
      return zerosRepeatingAtStartOfEvmBalance(formattedBalance)
        ? '0'
        : verifyZerosInBalanceAndFormat(parseFloat(formattedBalance), 4);
    } catch (error) {
      return '0';
    }
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
