import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';
// Removed unused import: INetworkType

import { fetchBackendAccountCached } from '../utils/fetchBackendAccountWrapper';
import { BigNumber } from 'utils/ethersV6Compat';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';

import { ISysBalanceController } from './types';

const SyscoinBalanceController = (): ISysBalanceController => {
  const getSysBalanceForAccount = async (
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => {
    const requestDetails = 'details=basic&pageSize=0';

    const xpubOrAddress = currentAccount.xpub || currentAccount.address;
    const accountData = await fetchBackendAccountCached(
      networkUrl,
      xpubOrAddress,
      requestDetails,
      true
    );

    // Validate and parse balance values with proper error handling
    const parseBalance = (value: unknown): BigNumber => {
      // Handle missing or invalid values
      if (value === undefined || value === null) {
        console.warn(
          '[SyscoinBalanceController] Missing balance value, defaulting to 0'
        );
        return BigNumber.from(0);
      }

      // Convert to string and trim whitespace
      const stringValue = String(value).trim();

      // Handle empty strings
      if (stringValue === '') {
        console.warn(
          '[SyscoinBalanceController] Empty balance value, defaulting to 0'
        );
        return BigNumber.from(0);
      }

      // Blockbook balances are signed integer satoshis. Keep strings exact,
      // including values larger than Number.MAX_SAFE_INTEGER.
      if (
        !/^-?\d+$/.test(stringValue) ||
        (typeof value === 'number' && !Number.isSafeInteger(value))
      ) {
        console.error(
          '[SyscoinBalanceController] Invalid balance value:',
          value
        );
        return BigNumber.from(0);
      }

      return BigNumber.from(stringValue);
    };

    // Parse balance and unconfirmedBalance safely
    const confirmedBalance = parseBalance(accountData?.balance);
    const unconfirmedBalance = parseBalance(accountData?.unconfirmedBalance);

    // Pending spends and self-transfer fees are already absent from the UTXO
    // set used to prepare sends. Include their signed delta in MAX's balance.
    const availableBalance = confirmedBalance.add(unconfirmedBalance);
    return availableBalance.gt(0) ? formatSyscoinValue(availableBalance) : '0';
  };

  return {
    getSysBalanceForAccount,
  };
};

export default SyscoinBalanceController;
