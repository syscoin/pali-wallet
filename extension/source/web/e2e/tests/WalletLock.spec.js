const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Lock button', () => {
  it('should check if lock button is working correctly after login', async () => {
    const { driver: webDriver } = await buildWebDriver();
    driver = webDriver;

    await driver.navigate();
    await driver.clickElement('#link-btn');
    await driver.fill('#import_phrase', CONSTANTS.IMPORT_WALLET);
    await driver.clickElement('#import-btn');
    await driver.fill('#basic_password', CONSTANTS.PASSWORD);
    await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
    await driver.clickElement('#next-btn');
    await driver.clickElement('#kebab-menu-btn');
    await driver.clickElement('.lock-btn');
    const findNewAccount = await driver.findElement(
      By.xpath("//*[text()='WELCOME TO']")
    );
    if (findNewAccount) {
      console.log('Lock buttton is working correctly');
    } else {
      console.log('Lock buttton is NOT working correctly');
    }
    driver.quit();
  });
});
