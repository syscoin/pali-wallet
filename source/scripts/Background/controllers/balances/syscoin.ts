import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
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

      const { balance } = await fetchBackendAccountCached(
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
