const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Lock button', () => {
  it('should check if lock button is working correctly after login', async () => {
    await initializator();
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
