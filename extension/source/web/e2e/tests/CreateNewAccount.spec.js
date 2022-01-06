const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Create New Account', () => {
  it('should create new account after login', async () => {
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
    await driver.clickElement('.accounts-btn');
    await driver.clickElement('.create-account-btn');
    await driver.fill('.new-account-name-input', 'Test Account');
    await driver.clickElement('#create-btn');
    await driver.clickElement('#got-it-btn');
    await driver.clickElement('#kebab-menu-btn');
    await driver.clickElement('.accounts-btn');
    const findNewAccount = await driver.findElement(
      By.xpath("//*[text()='Test Account']")
    );
    if (findNewAccount) {
      console.log('New Account has been created');
    } else {
      console.log('New Account has not been created');
    }
    driver.quit();
  });
});
