const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
const { renderHook, act } = require('@testing-library/react-hooks');
const { By } = require('selenium-webdriver');
// const useAccount = require('../../../hooks/useAccount.ts')


describe('account test', () => {
  it('should find a logged account', async () => {
    const { driver: webDriver } = await buildWebDriver();
    driver = webDriver;

    await driver.navigate();

    await driver.clickElement('#link-btn');
    await driver.fill('#import_phrase', CONSTANTS.IMPORT_WALLET);
    await driver.clickElement('#import-btn');
    await driver.fill('#basic_password', CONSTANTS.PASSWORD);
    await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
    await driver.clickElement('#next-btn');
    const findAccount = await driver.findAllElementsWithId('active-account');
    if (findAccount) {
      console.log('Found account');
    } else{
      console.log('Not found account');
    }
    driver.quit();


  });
});