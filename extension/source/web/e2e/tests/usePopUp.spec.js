const { buildWebDriver } = require('../webdriver');
const CONSTANTS = require('../constants');
const { browser } = require('webextension-polyfill-ts');
// const { windows } = require('webextension-polyfill');



// const closeWindow = async ({ title }) => {
//   const getTabs = async ({ options }) => {
//     return await browser.tabs?.query(options);
//   };

//   const tabs = await getTabs({ options: { active: true } });

//   try {
//     tabs?.map(async (tab) => {
//       if (tab.title === title) {
//         await browser.windows.remove(Number(tab.windowId));
//       }
//     });
//   } catch (error) {
//     console.log('error removing window', error);
//   }
// };

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
    try {
      const tabs = await browser.extension?.getViews()
      console.log(tabs)
    } catch (error) {
      console.log(error)
    }

    driver.quit()



  });
});