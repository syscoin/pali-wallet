/*const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');
const { initialMockState, SYS_NETWORK } = require('../../state/store');

const { accounts } = initialMockState;

describe('Delete wallet', () => {
  it('should delete wallet after import wallet', async () => {
    await initializator();
    setTimeout(async () => {
      await driver.clickElement('.settings-btn');
    }, 2000);
    await driver.clickElement('.delete-wallet-btn');
    await driver.fill('#delete_password', CONSTANTS.PASSWORD);

    if (accounts[0].balance > 0) {
      await driver.fill('#delete_seed', CONSTANTS.IMPORT_WALLET);
    }
    await driver.clickElement('#delete-btn');

    const findGetStarted = await driver.findElement(
      By.xpath("//*[text()='Get started']")
    );
    if (findGetStarted) {
      console.log('DeleteWallet is working correctly');
    } else {
      console.log('DeleteWallet is NOT working correctly');
    }
    driver.quit();
  });
});*/
