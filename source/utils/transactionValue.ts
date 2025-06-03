import BigNumber from 'bignumber.js';

import { TransactionValueType } from 'scripts/Background/controllers/transactions/types';

export const convertTransactionValueToCompare = (
  value: TransactionValueType
): number => {
  if (typeof value === 'string') {
    if (value.startsWith('0x')) {
      return new BigNumber(value).toNumber();
    } else {
      return parseFloat(value);
    }
  } else if (typeof value === 'number') {
    return value;
  } else if ('isBigNumber' in value) {
    return new BigNumber(value._hex).toNumber();
  } else if ('type' in value && 'hex' in value) {
    return new BigNumber(value.hex).toNumber();
  }
};
