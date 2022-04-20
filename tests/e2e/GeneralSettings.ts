// import assert from 'assert';

// import { By } from 'selenium-webdriver';
// import clipboard from 'copy-paste';

// import { FAKE_PASSWORD, FAKE_SEED_PHRASE } from '../mocks';

// import { buildWebDriver, Driver } from './driver';
// import { importWallet } from './initialize';

// describe('General settings tests', () => {
//   let uiWebDriver: Driver;

//   beforeEach(async () => {
//     const { driver } = await buildWebDriver();

//     uiWebDriver = driver;

//     await driver.navigate();
//     await importWallet({ driver });
//   });

//   afterEach(async () => {
//     await uiWebDriver.quit();
//   });

//   it('should check general settings button ', async () => {
//     const generalSettingsButton = await uiWebDriver.findElement(
//       By.id('general-settings-button')
//     );

//     assert.ok(
//       generalSettingsButton,
//       '<!> Cannot find general settings button <!>'
//     );
//   });

//   it('should display the correct seed', async () => {
//     await uiWebDriver.clickElement('#general-settings-button');
//     //* go to wallet seed phrase
//     await uiWebDriver.clickElement('#wallet-seed-phrase-btn');
//     //* input password
//     await uiWebDriver.fill('#phraseview_password', FAKE_PASSWORD);
//     await uiWebDriver.clickElement('#copy-btn');

//     const currentClipboard = clipboard.paste();
//     const expectedClipboard = FAKE_SEED_PHRASE;

//     //* check if it is copying correctly after click on copy button
//     expect(currentClipboard).toBe(expectedClipboard);
//   });

//   it('should open a new tab to redirect the user to syscoin discord for support', async () => {
//     await uiWebDriver.clickElement('#general-settings-button');
//     //  * go to info/help
//     await uiWebDriver.clickElement('#info-help-btn');
//     //    * click on element to open the discord invite in a new tab
//     await uiWebDriver.clickElement('#user-support-btn');
//     try {
//       await uiWebDriver.switchToWindowWithTitle('Syscoin', null);
//     } catch (error) {
//       assert.ifError(error);
//     }
//     const url = await uiWebDriver.getCurrentUrl();
//     const expectedUrl = 'https://discord.com/invite/8QKeyurHRd';
//     //    * check if this is being redirected to https://discord.com/invite/8QKeyurHRd
//     expect(url).toBe(expectedUrl);
//   });
// });

export {};
