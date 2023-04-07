import sys from 'syscoinjs-lib';

import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { ISysBalanceController } from './types';

const SyscoinBalanceController = (): ISysBalanceController => {
  const getSysBalanceForAccount = async (xpub: string, networkUrl: string) => {
    try {
      const requestDetails = 'details=basic&pageSize=0';

      const { balance } = await sys.utils.fetchBackendAccount(
        networkUrl,
        xpub,
        requestDetails,
        true
      );

      const formattedBalance = balance / 1e8;

      //Prevent to send undefined from verifyZeros when formattedBalance is 0
      return formattedBalance > 0
        ? verifyZerosInBalanceAndFormat(formattedBalance, 8)
        : '0';
    } catch (error) {
      return '0';
    }
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
