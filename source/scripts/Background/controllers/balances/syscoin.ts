import sys from 'syscoinjs-lib';

import { IPaliAccount } from 'state/vault/types';
import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { ISysBalanceController } from './types';

const SyscoinBalanceController = (): ISysBalanceController => {
  const getSysBalanceForAccount = async (
    currentAccount: IPaliAccount,
    networkUrl: string
  ) => {
    try {
      const requestDetails = 'details=basic&pageSize=0';

      const { balance } = await sys.utils.fetchBackendAccount(
        networkUrl,
        currentAccount.xpub,
        requestDetails,
        true
      );

      const formattedBalance = balance / 1e8;

      //Prevent to send undefined from verifyZeros when formattedBalance is 0
      return formattedBalance > 0
        ? verifyZerosInBalanceAndFormat(formattedBalance, 8)
        : '0';
    } catch (error) {
      return String(currentAccount.balances.syscoin);
    }
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
