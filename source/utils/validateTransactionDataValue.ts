import { ethers } from 'ethers';

export const validateTransactionDataValue = (data: string) =>
  data.length > 0
    ? data.substring(0, 2) === '0x'
      ? data
      : ethers.utils.formatBytes32String(data)
    : '';
