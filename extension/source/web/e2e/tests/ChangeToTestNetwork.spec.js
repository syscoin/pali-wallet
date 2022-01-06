const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');

describe('Change Network test', () => {
  it('should change network to testnet after login', async () => {
    const { driver: webDriver } = await buildWebDriver();
    driver = webDriver;

    await driver.navigate();

    await driver.clickElement('#link-btn');
    await driver.fill('#import_phrase', CONSTANTS.IMPORT_WALLET);
    await driver.clickElement('#import-btn');
    await driver.fill('#basic_password', CONSTANTS.PASSWORD);
    await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
    await driver.clickElement('#next-btn');
    await driver.clickElement('.menu-btn');
    await driver.clickElement('.sys-btn');
    await driver.clickElement('#test-btn');

    driver.quit();
  });
});
