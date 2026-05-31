import { formatBytes32String } from '@ethersproject/strings';

export const validateTransactionDataValue = (data: string | undefined) => {
  if (!data) return '0x';

  return data.length > 0
    ? data.substring(0, 2) === '0x'
      ? data
      : formatBytes32String(data)
    : '0x';
};
