import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';
// Removed unused import: INetworkType

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

import { ISysBalanceController } from './types';

const SyscoinBalanceController = (): ISysBalanceController => {
  const getSysBalanceForAccount = async (
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => {
    const requestDetails = 'details=basic&pageSize=0';

    const accountData = await fetchBackendAccountCached(
      networkUrl,
      currentAccount.xpub,
      requestDetails,
      true
    );

    // Validate and parse balance values with proper error handling
    const parseBalance = (value: any): number => {
      // Handle missing or invalid values
      if (value === undefined || value === null) {
        console.warn(
          '[SyscoinBalanceController] Missing balance value, defaulting to 0'
        );
        return 0;
      }

      // Convert to string and trim whitespace
      const stringValue = String(value).trim();

      // Handle empty strings
      if (stringValue === '') {
        console.warn(
          '[SyscoinBalanceController] Empty balance value, defaulting to 0'
        );
        return 0;
      }

      // Parse the number
      const parsed = Number(stringValue);

      // Check for NaN or invalid numbers
      if (isNaN(parsed) || !isFinite(parsed)) {
        console.error(
          '[SyscoinBalanceController] Invalid balance value:',
          value
        );
        return 0;
      }

      return parsed;
    };

    // Parse balance and unconfirmedBalance safely
    const confirmedBalance = parseBalance(accountData?.balance);
    const unconfirmedBalance = parseBalance(accountData?.unconfirmedBalance);

    // Convert from satoshis to SYS safely without precision loss
    // Using formatSyscoinValue which handles large values correctly
    const confirmedBalanceInSys = parseFloat(
      formatSyscoinValue(confirmedBalance.toString())
    );
    const unconfirmedBalanceInSys = parseFloat(
      formatSyscoinValue(unconfirmedBalance.toString())
    );

    // For display purposes, show the total spendable balance
    // This includes confirmed balance + pending incoming (positive unconfirmed)
    // but excludes pending outgoing (negative unconfirmed) to avoid confusion
    let displayBalance: number;

    if (unconfirmedBalanceInSys >= 0) {
      // Positive unconfirmed means incoming transaction - add to total
      displayBalance = confirmedBalanceInSys + unconfirmedBalanceInSys;
    } else {
      // Negative unconfirmed means outgoing transaction
      // Show only confirmed balance to avoid confusion
      // The pending transaction might fail or be replaced
      displayBalance = confirmedBalanceInSys;
    }

    // Ensure balance is not negative (should not happen with the logic above)
    const formattedBalance = Math.max(0, displayBalance);

    //Prevent to send undefined from verifyZeros when formattedBalance is 0
    return formattedBalance > 0
      ? verifyZerosInBalanceAndFormat(formattedBalance, 8)
      : '0';
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
