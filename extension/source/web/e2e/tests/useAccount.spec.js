const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
const { renderHook, act } = require('@testing-library/react-hooks');
// const useAccount = require('../../../hooks/useAccount.ts')


describe('closeExtension test', () => {
    it('should close extension after login', async () => {
      const { driver: webDriver } = await buildWebDriver();
      driver = webDriver;
  
      await driver.navigate();
  
      await driver.clickElement('#link-btn');
      await driver.fill('#import_phrase', CONSTANTS.IMPORT_WALLET);
      await driver.clickElement('#import-btn');
      await driver.fill('#basic_password', CONSTANTS.PASSWORD);
      await driver.fill('#basic_repassword', CONSTANTS.PASSWORD);
      await driver.clickElement('#next-btn');
      // await closeWindow('Pali Wallet');
      // const result = browserName();
      // if(result){
      //   console.log(result)
      // }
      // browserEnv(['navigator']);
      // const tabs = global.navigator?.userAgent.match(/chrome|chromium|crios/i)
      // console.log(tabs)
      // const { activeAccount } = useAccount();
      const tabs = await browser?.tabs?.getCurrent;
      console.log()
      driver.quit()
  
  
    });
  });