import { ethers } from 'ethers';

export const validatePrivateKeyValue = (privKey: string) => {
  //Get 2 first characters to validate if starts with 0x or not
  const checkInitialValue = privKey.slice(0, 2);
  const adjustedPrivKeyValue =
    checkInitialValue === '0x' ? privKey : `0x${privKey}`;

  try {
    new ethers.Wallet(adjustedPrivKeyValue);
  } catch (error) {
    return false;
  }

  return true;
};
