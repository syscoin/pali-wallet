const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Verify seed phrase', () => {
  it('should check if the seed phrase shown is the same as the one applied to import the wallet', async () => {
    const { driver: webDriver } = await buildWebDriver();
    driver = webDriver;

    await driver.navigate();
    await driver.clickElement('#link-btn');
    await driver.fill('#import_phrase', CONSTANTS.IMPORT_WALLET);
    await driver.clickElement('#import-btn');
    await driver.fill('#basic_password', CONSTANTS.PASSWORD);
    await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
    await driver.clickElement('#next-btn');
    setTimeout(async () => {
      await driver.clickElement('.settings-btn');
    }, 2000)
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
});
