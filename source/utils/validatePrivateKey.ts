import { ethers } from 'ethers';

import { getController } from 'scripts/Background';
import { INetworkWithKind } from 'state/vault/types';

export const validatePrivateKeyValue = (
  privKey: string,
  isBitcoinBased: boolean,
  activeNetwork?: INetworkWithKind
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
