const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { renderHook, act } = require('@testing-library/react-hooks');
const { By } = require('selenium-webdriver');
// const useAccount = require('../../../hooks/useAccount.ts')

describe('account test', () => {
  it('should find a logged account', async () => {
    await initializator();
    const findAccount = await driver.findAllElementsWithId('active-account');
    if (findAccount) {
      console.log('Found account');
    } else {
      console.log('Not found account');
    }
    driver.quit();
  });
});

