// const initializator = require('../initializator');
// const { browser } = require('webextension-polyfill-ts');
// const { By } = require('selenium-webdriver');
// const { buildWebDriver } = require('../../webdriver');

// describe('Account settings test', () => {
//   it("should check if your keys button it's being shown and working correctly", async () => {
//     await initializator();
//     await driver.clickElement('.kebab-menu-btn');
//     const findYourKeysBtn = await driver.findElement(
//       By.className('.your-keys-btn')
//     );
//     if (findYourKeysBtn) {
//       console.log('your keys button is being shown');
//     } else {
//       console.log('your keys button is NOT being shown');
//     }
//     await driver.clickElement('.your-keys-btn');
//     const findYourKeys = await driver.findElement(
//       By.xpath("//*[text()='To see your private key, input your password']")
//     );
//     if (findYourKeys) {
//       console.log('your keys button is working correctly');
//     } else {
//       console.log('your keys button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it('should create new account after login', async () => {
//     let driver;
//     const { driver: webDriver } = await buildWebDriver();
//     driver = webDriver;
//     await initializator();
//     await driver.clickElement('.kebab-menu-btn');
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('.create-account-btn');
//     await driver.fill('.new-account-name-input', 'Test Account');
//     await driver.clickElement('#create-btn');
//     await driver.clickElement('#got-it-btn');
//     await driver.clickElement('.kebab-menu-btn');
//     await driver.clickElement('.accounts-btn');
//     const findNewAccount = await driver.findElement(
//       By.xpath("//*[text()='Test Account']")
//     );
//     if (findNewAccount) {
//       console.log('New Account has been created');
//     } else {
//       console.log('New Account has not been created');
//     }
//     driver.quit();
//   });

//   it('should switch account after create new account', async () => {
//     let driver;
//     const { driver: webDriver } = await buildWebDriver();
//     driver = webDriver;
//     await initializator();
//     const findDefaultActiveAccount = setTimeout(async () => {
//       await driver.findElement(By.xpath("//*[text()='Account 1']"));
//     }, 2000);
//     if (findDefaultActiveAccount) {
//       console.log('Account 1 is the active account set by default');
//     } else {
//       console.log('Account 1 is NOT the active account set by default');
//     }
//     setTimeout(async () => {
//       await driver.clickElement('.kebab-menu-btn');
//     }, 2000);
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('.create-account-btn');
//     await driver.fill('.new-account-name-input', 'Test Account');
//     await driver.clickElement('#create-btn');
//     await driver.clickElement('#got-it-btn');
//     await driver.clickElement('.kebab-menu-btn');
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('#account-1');
//     const findNewActiveAccount = await driver.findElement(
//       By.xpath("//*[text()='Test Account']")
//     );
//     if (findNewActiveAccount) {
//       console.log('Switch Account is working correctly');
//     } else {
//       console.log('Switch Account is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if hardware wallet button it's being shown and working correctly", async () => {
//     await initializator();
//     await driver.clickElement('.kebab-menu-btn');
//     const findHardwareWalletBtn = await driver.findElement(
//       By.className('.hardware-wallet-btn')
//     );
//     if (findHardwareWalletBtn) {
//       console.log('hardware wallet button is being shown');
//     } else {
//       console.log('hardware wallet button is NOT being shown');
//     }
//     await driver.clickElement('.hardware-wallet-btn');
//     const findHardwareWallet = await driver.findElement(
//       By.xpath(
//         "//*[text()='Select the hardware wallet you'd like to connect to Pali']"
//       )
//     );
//     if (findHardwareWallet) {
//       console.log('hardware wallet button is working correctly');
//     } else {
//       console.log('hardware wallet button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it('should check if lock button is working correctly after login', async () => {
//     await initializator();
//     await driver.clickElement('.kebab-menu-btn');
//     await driver.clickElement('.lock-btn');
//     const findNewAccount = await driver.findElement(
//       By.xpath("//*[text()='WELCOME TO']")
//     );
//     if (findNewAccount) {
//       console.log('Lock buttton is working correctly');
//     } else {
//       console.log('Lock buttton is NOT working correctly');
//     }
//     driver.quit();
//   });
// });
