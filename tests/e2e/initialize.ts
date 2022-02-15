import { FAKE_SEED_PHRASE, FAKE_PASSWORD } from '../../source/constants/index';

export const importWallet = async ({ driver }) => {
  await driver.navigate();

  await driver.clickElement('#import-wallet-link');
  await driver.fill('#import-wallet-input', FAKE_SEED_PHRASE);
  await driver.clickElement('#import-wallet-action');
  await driver.fill('#basic_password', FAKE_PASSWORD);
  await driver.fill('#basic_repassword', FAKE_PASSWORD);
  await driver.clickElement('#create-password-action');
};
