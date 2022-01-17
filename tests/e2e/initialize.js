const { buildWebDriver } = require('./webdriver');

const CONSTANTS = require('./constants');

const importWallet = async () => {
  const { driver } = await buildWebDriver();

  await driver.navigate();

  await driver.clickElement('#create-wallet');
  await driver.fill('#import-wallet-input', CONSTANTS.IMPORT_WALLET);
  await driver.clickElement('#import-action');
  await driver.fill('#basic_password', CONSTANTS.PASSWORD);
  await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
  await driver.clickElement('#next-btn');
};

module.exports = {
  importWallet,
};
