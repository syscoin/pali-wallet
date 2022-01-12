const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');

describe('closeExtension test', () => {
  it('should close extension after login', async () => {
    await initializator();
    const titlePage = await driver.getTitle();
    if (titlePage === 'Pali Wallet') {
      driver.close();
    } else {
      console.log('Not found window');
    }
  });
});
