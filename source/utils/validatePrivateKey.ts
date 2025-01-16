import { ethers } from 'ethers';

import { getController } from 'scripts/Background';

export const validatePrivateKeyValue = (
  privKey: string,
  isBitcoinBased: boolean
) => {
  const mainController = getController();
  const initialValue = privKey.match(/^(0x|zprv)/)?.[0];

  if ([undefined, '0x'].includes(initialValue) && !isBitcoinBased) {
    try {
      new ethers.Wallet(initialValue === undefined ? `0x${privKey}` : privKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  if (initialValue === 'zprv' && isBitcoinBased) {
    const { isValid } = mainController.wallet.validateZprv(privKey);
    return isValid;
  }

  return false;
};
