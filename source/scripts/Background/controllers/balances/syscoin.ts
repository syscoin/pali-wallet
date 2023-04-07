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

      return verifyZerosInBalanceAndFormat(formattedBalance, 8);
    } catch (error) {
      return '0';
    }
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
