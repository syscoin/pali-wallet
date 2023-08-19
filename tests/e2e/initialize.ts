import { MOCK_SEED_PHRASE, MOCK_PASSWORD } from '../mocks';

import { Driver } from './driver';

export const importWallet = async (driver: Driver) => {
  try {
    await driver.navigate();
    await driver.clickElement('#import-wallet-link');
    await driver.fill('#import-wallet-input', MOCK_SEED_PHRASE);
    await driver.clickElement('#import-wallet-action');
    await driver.fill('#basic_password', MOCK_PASSWORD);
    await driver.fill('#basic_repassword', MOCK_PASSWORD);
    await driver.clickElement('#create-password-action');
  } catch (error) {
    console.error('Error in importWallet:', error);
    throw error;
  }
};
