const { buildWebDriver } = require('./webdriver');
const CONSTANTS = require('./constants');

const initializator = async () => {
  let driver;
  const { driver: webDriver } = await buildWebDriver();
  driver = webDriver;

  await driver.navigate();

  await driver.clickElement('#link-btn');
  await driver.fill('#import-phrase', CONSTANTS.IMPORT_WALLET);
  await driver.clickElement('#import-btn');
  await driver.fill('#basic_password', CONSTANTS.PASSWORD);
  await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
  await driver.clickElement('#next-btn');
};

module.exports = initializator;
