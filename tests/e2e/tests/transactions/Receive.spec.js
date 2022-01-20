// const initializator = require('../initializator');
// const { browser } = require('webextension-polyfill-ts');
// const { By } = require('selenium-webdriver');

// describe('Receive Screen Tests', () => {
//   it('should check if receive qr code is being shown', async () => {
//     await initializator();
//     await driver.clickElement('.receive-btn');
//     const findQRCode = await driver.findElement(By.className('.qr-code'));
//     if (findQRCode) {
//       console.log('qr code is being shown');
//     } else {
//       console.log('qr code is NOT being shown');
//     }
//     driver.quit();
//   });

//   it("should check if copy address button it's being shown and working correctly", async () => {
//     await initializator();
//     const copyAddressBtn = await driver.findElement(
//       By.className('.copy-address-receive-btn')
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
// });
