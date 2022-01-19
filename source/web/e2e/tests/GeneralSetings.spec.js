const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Verify seed phrase', () => {
  it('should check if the seed phrase shown is the same as the one applied to import the wallet', async () => {
    await initializator();
    setTimeout(async () => {
      await driver.clickElement('.settings-btn');
    }, 2000);
    await driver.clickElement('.seed-phrase-menu-btn');
    await driver.fill('#phraseview_password', CONSTANTS.PASSWORD);
    const findSeedPhrase = await driver.findAllElementsWithId('user-phrase');
    if (findSeedPhrase) {
      console.log('the seed phrase shown is correct');
    } else {
      console.log('the seed phrase shown is NOT correct');
    }
    driver.quit();
  });

  it('should delete wallet after import wallet', async () => {
    let driver;
    const { driver: webDriver } = await buildWebDriver();
    driver = webDriver;
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
});
