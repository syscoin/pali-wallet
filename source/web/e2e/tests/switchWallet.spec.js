const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Switch Account', () => {
  it('should switch account after create new account', async () => {
    await initializator();
    const findDefaultActiveAccount = await driver.findElement(
      By.xpath("//*[text()='Account 1']")
    );
    if (findDefaultActiveAccount) {
      console.log('Account 1 is the active account set by default');
    } else {
      console.log('Account 1 is NOT the active account set by default');
    }
    setTimeout(async () => {
      await driver.clickElement('#kebab-menu-btn');
    }, 2000);
    await driver.clickElement('.accounts-btn');
    await driver.clickElement('.create-account-btn');
    await driver.fill('.new-account-name-input', 'Test Account');
    await driver.clickElement('#create-btn');
    await driver.clickElement('#got-it-btn');
    await driver.clickElement('#kebab-menu-btn');
    await driver.clickElement('.accounts-btn');
    await driver.clickElement('#account-1');
    const findNewActiveAccount = await driver.findElement(
      By.xpath("//*[text()='Test Account']")
    );
    if (findNewActiveAccount) {
      console.log('Switch Account is working correctly');
    } else {
      console.log('Switch Account is NOT working correctly');
    }
    driver.quit();
  }); 
});
