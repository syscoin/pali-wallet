import { ethers } from 'ethers';

export const validatePrivateKeyValue = (privKey: string) => {
  //Get 2 first characters to validate if starts with 0x or not
  const initialValue = privKey.slice(0, 2);

  switch (initialValue) {
    case '0x':
      try {
        new ethers.Wallet(`${privKey}`);
      } catch (error) {
        return false;
      }
      return true;

    default:
      try {
        new ethers.Wallet(`0x${privKey}`);
      } catch (error) {
        return false;
      }

      return true;
  }
};
