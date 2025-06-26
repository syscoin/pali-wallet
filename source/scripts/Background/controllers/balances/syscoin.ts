import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';
// Removed unused import: INetworkType

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { ISysBalanceController } from './types';

const SyscoinBalanceController = (): ISysBalanceController => {
  const getSysBalanceForAccount = async (
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => {
    try {
      const requestDetails = 'details=basic&pageSize=0';

      const { balance, unconfirmedBalance } = await fetchBackendAccountCached(
        networkUrl,
        currentAccount.xpub,
        requestDetails,
        true
      );

      // Calculate total spendable balance by adding confirmed + unconfirmed
      // unconfirmedBalance can be negative (pending outgoing) or positive (pending incoming)
      const totalBalance = (Number(balance) + Number(unconfirmedBalance)) / 1e8;

      // Ensure balance is not negative (can happen with large pending outgoing transactions)
      const formattedBalance = Math.max(0, totalBalance);

      //Prevent to send undefined from verifyZeros when formattedBalance is 0
      return formattedBalance > 0
        ? verifyZerosInBalanceAndFormat(formattedBalance, 8)
        : '0';
    } catch (error) {
      console.error(
        '[SyscoinBalanceController] Failed to fetch balance:',
        error
      );
      throw error; // Properly propagate the error instead of masking it
    }
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
