/*const initializator = require('../initializator');
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
});*/
