import { CONSTANTS } from './data/constants';

export const importWallet = async ({ driver }) => {
  await driver.navigate();

  await driver.clickElement('#import-wallet-link');
  await driver.fill('#import-wallet-input', CONSTANTS.SEED_PHRASE);
  await driver.clickElement('#import-wallet-action');
  await driver.fill('#basic_password', CONSTANTS.PASSWORD);
  await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
  await driver.clickElement('#create-password-action');
};
