import MainController from 'scripts/Background/controllers/MainController';

import { MOCK_PASSWORD } from './mocks';

export const getWalletMockState = () => {
  const controller = MainController();

  const initializeWallet = async () => {
    // * set password before creating a new seed phrase
    controller.setWalletPassword(MOCK_PASSWORD);

    // * create a new seed phrase
    controller.createSeed();

    // * after setting the password and the seed, create a new wallet
    return await controller.createWallet(MOCK_PASSWORD);
  };

  return {
    initializeWallet,
  };
};
