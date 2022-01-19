/*const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Set wallet password', () => {
  it('should create a new password and try to sign in', async () => {
    await initializator();
    await driver.clickElement('#kebab-menu-btn');
    await driver.clickElement('.lock-btn');
    await driver.fill('#basic_password', CONSTANTS.PASSWORD);
    await driver.clickElement('#unlock-btn');
    const findNewAccount = await driver.findElement(
      By.xpath("//*[text()='Assets']")
    );
    if (findNewAccount) {
      console.log('setWalletPassword is working correctly');
    } else {
      console.log('setWalletPassword is NOT working correctly');
    }
    driver.quit();
  });
});*/
