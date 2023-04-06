import { ethers } from 'ethers';

import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { IEvmBalanceController } from './types';

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

      return verifyZerosInBalanceAndFormat(parseFloat(formattedBalance), 4);
    } catch (error) {
      return '0';
    }
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
