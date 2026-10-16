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
    // Blockbook basic summaries intentionally skip mempool aggregation.
    // Match the asset query so native balance includes its signed pending delta.
    const requestDetails = 'details=tokenBalances&tokens=nonzero';

    const xpubOrAddress = currentAccount.xpub || currentAccount.address;
    const accountData = await fetchBackendAccountCached(
      networkUrl,
      xpubOrAddress,
      requestDetails,
      true
    );

    // Validate and parse balance values with proper error handling
    const parseBalance = (value: unknown, required = false): BigNumber => {
      const stringValue =
        value === undefined || value === null ? '' : String(value).trim();
      // Blockbook balances are signed integer satoshis. Keep strings exact,
      // including values larger than Number.MAX_SAFE_INTEGER.
      if (
        !/^-?\d+$/.test(stringValue) ||
        (typeof value === 'number' && !Number.isSafeInteger(value))
      ) {
        if (required) {
          throw new Error(
            'Pending native balance delta is unavailable or invalid'
          );
        }
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
    const unconfirmedBalance = parseBalance(
      accountData?.unconfirmedBalance,
      Number(accountData?.unconfirmedTxs ?? 0) > 0
    );

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
