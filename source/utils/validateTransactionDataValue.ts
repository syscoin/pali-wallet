import { formatBytes32String } from '@ethersproject/strings';

export const validateTransactionDataValue = (data: string | undefined) => {
  if (!data) return '';

  return data.length > 0
    ? data.substring(0, 2) === '0x'
      ? data
      : formatBytes32String(data)
    : '';
};
