import { ethers } from 'ethers';

import {
  CustomJsonRpcProvider,
  CustomL2JsonRpcProvider,
} from '@pollum-io/sysweb3-keyring';

import { IPaliAccount } from 'state/vault/types';
import { ONE_MILLION } from 'utils/constants';
import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { IEvmBalanceController } from './types';
import { zerosRepeatingAtStartOfEvmBalance } from './utils';

const EvmBalanceController = (
  web3Provider: CustomJsonRpcProvider | CustomL2JsonRpcProvider
): IEvmBalanceController => {
  const getEvmBalanceForAccount = async (currentAccount: IPaliAccount) => {
    try {
      //LATER CHANGE THIS TO USE NEW PROVIDER FROM SYSWEB3
      const provider = web3Provider;

      const getBalance = await provider.getBalance(currentAccount.address);

      const formattedBalance = ethers.utils.formatEther(getBalance);

      if (+formattedBalance >= ONE_MILLION) {
        return formattedBalance;
      }

      //Validate quantity of zeros in the start of balance to don't how a big 0 decimal number
      return zerosRepeatingAtStartOfEvmBalance(formattedBalance)
        ? '0'
        : verifyZerosInBalanceAndFormat(parseFloat(formattedBalance), 4);
    } catch (error) {
      return String(currentAccount.balances.ethereum);
    }
  };

  return {
    getEvmBalanceForAccount,
  };
};

export default EvmBalanceController;
