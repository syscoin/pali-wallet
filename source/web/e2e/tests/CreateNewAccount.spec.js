const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Create New Account', () => {
  it('should create new account after login', async () => {
    await initializator();
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
