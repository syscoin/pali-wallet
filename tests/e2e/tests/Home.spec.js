import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';
import { storeState } from '../../../source/state/store';

describe('<Home /> tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach(() => {
    uiWebDriver.quit();
  });

  it('should show balance correctly', async () => {
    const balance = await uiWebDriver.findElement(By.id('home-balance'));

    const { accounts, activeAccountId } = storeState.wallet;

    if (accounts[activeAccountId]) {
      const balanceValue = await balance.getText();
      const expectedBalance = accounts[activeAccountId].balance;

      assert.equal(
        balanceValue,
        expectedBalance,
        '<!> Balance different than the expected <!>'
      );
    }
  });
});

// const initializator = require('../initializator');
// const { browser } = require('webextension-polyfill-ts');
// const { By } = require('selenium-webdriver');

// describe('Home Screen Tests', () => {
// it('should check if balance and currency are being shown', async () => {
//   await initializator();
//   const findBalance = await driver.findElement(
//     By.className('.balance-account')
//   );
//   if (findBalance) {
//     console.log('Balance is being shown');
//   } else {
//     console.log('Balance is NOT being shown');
//   }
//   const findCurrency = await driver.findElement(By.id('#fiat-ammount'));
//   if (findCurrency) {
//     console.log('Currency is being shown');
//   } else {
//     console.log('Currency is NOT being shown');
//   }
//   driver.quit();
// });

//   it("should check if send button it's being shown and working correctly", async () => {
//     await initializator();
//     const findSend = await driver.findElement(By.className('.send-btn'));
//     if (findSend) {
//       console.log('Send button is being shown');
//     } else {
//       console.log('Send button is NOT being shown');
//     }
//     await driver.clickElement('.send-btn');
//     const findSendSYS = await driver.findElement(
//       By.xpath("//*[text()='SEND SYS']")
//     );
//     if (findSendSYS) {
//       console.log('Send button is working correctly');
//     } else {
//       console.log('Send button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if receive button it's being shown and working correctly", async () => {
//     await initializator();
//     const findreceive = await driver.findElement(By.className('.receive-btn'));
//     if (findreceive) {
//       console.log('receive button is being shown');
//     } else {
//       console.log('receive button is NOT being shown');
//     }
//     await driver.clickElement('.receive-btn');
//     const findReceiveSYS = await driver.findElement(
//       By.xpath("//*[text()='RECEIVE SYS']")
//     );
//     if (findReceiveSYS) {
//       console.log('receive button is working correctly');
//     } else {
//       console.log('receive button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if copy address button it's being shown and working correctly", async () => {
//     await initializator();
//     const copyAddressBtn = await driver.findElement(
//       By.className('.copy-address-btn')
//     );
//     if (copyAddressBtn) {
//       console.log('copy address button is being shown');
//     } else {
//       console.log('copy address button is NOT being shown');
//     }
//     const value = copyAddresBtn.getAttribute('value');

//     if (value === 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax') {
//       console.log('copy-address button is working correctly');
//     } else {
//       console.log('copy-address button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if general settings button it's being shown and working correctly", async () => {
//     await initializator();
//     const findGeneralSettingsBtn = await driver.findElement(
//       By.className('.settings-btn')
//     );
//     if (findGeneralSettingsBtn) {
//       console.log('general settings button is being shown');
//     } else {
//       console.log('general settings button is NOT being shown');
//     }
//     await driver.clickElement('.settings-btn');
//     const findGeneralSettings = await driver.findElement(
//       By.xpath("//*[text()='GENERAL SETTINGS']")
//     );
//     if (findGeneralSettings) {
//       console.log('General settings button is working correctly');
//     } else {
//       console.log('General settings button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if network settings button it's being shown and working correctly", async () => {
//     await initializator();
//     const findNetworkSettingsBtn = await driver.findElement(
//       By.className('.menu-btn')
//     );
//     if (findNetworkSettingsBtn) {
//       console.log('network settings button is being shown');
//     } else {
//       console.log('network settings button is NOT being shown');
//     }
//     await driver.clickElement('.menu-btn');
//     const findNetworkSettings = await driver.findElement(
//       By.xpath("//*[text()='NETWORK SETTINGS']")
//     );
//     if (findNetworkSettings) {
//       console.log('network settings button is working correctly');
//     } else {
//       console.log('network settings button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if account settings button(kebab) it's being shown and working correctly", async () => {
//     await initializator();
//     const findAccountSettingsBtn = await driver.findElement(
//       By.className('.kebab-menu-btn')
//     );
//     if (findAccountSettingsBtn) {
//       console.log('account settings button is being shown');
//     } else {
//       console.log('account settings button is NOT being shown');
//     }
//     await driver.clickElement('.kebab-menu-btn');
//     const findAccountSettings = await driver.findElement(
//       By.xpath("//*[text()='ACCOUNT SETTINGS']")
//     );
//     if (findAccountSettings) {
//       console.log('account settings button is working correctly');
//     } else {
//       console.log('account settings button is NOT working correctly');
//     }
//     driver.quit();
//   });

//   it("should check if connected badge it's being shown", async () => {
//     await initializator();
//     const findBadgeConnected = await driver.findElement(
//       By.className('.badge-connected-status')
//     );
//     if (findBadgeConnected) {
//       console.log('badge connected is being shown');
//     } else {
//       console.log('badge connected is NOT being shown');
//     }
//     driver.quit();
//   });
// });
