import { ethers } from 'ethers';

import { INetwork } from '@pollum-io/sysweb3-network';

import { getController } from 'scripts/Background';

export const validatePrivateKeyValue = (
  privKey: string,
  isBitcoinBased: boolean,
  activeNetwork?: INetwork
) => {
  const mainController = getController();

  if (!isBitcoinBased) {
    try {
      new ethers.Wallet(privKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  if (isBitcoinBased) {
    const { isValid } = mainController.wallet.validateZprv(
      privKey,
      activeNetwork
    );
    return isValid;
  }

  return false;
};
