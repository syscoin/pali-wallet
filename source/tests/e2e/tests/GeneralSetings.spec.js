import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';

describe('General settings UI test', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
    await uiWebDriver.clickElement('#settings-btn');
  });

  afterEach(() => {
    uiWebDriver.quit();
  });

  it("should check if auto lock timer button it's being shown and working correctly", async () => {
    const autoLockTimerButton = await uiWebDriver.findElement(
      By.id('auto-lock-timer-btn')
    );

    assert.ok(
      typeof autoLockTimerButton === 'object',
      '<!> Cannot find auto lock timer button <!>'
    );

    await uiWebDriver.clickElement('#your-keys-btn');
    const findAutoLockTimerTitle = await uiWebDriver.findElement(
      By.id('auto-lock-timer-title')
    );
    const autoLockTimerText = await findAutoLockTimerTitle.getText();
    assert.equal(
      autoLockTimerText,
      'AUTO LOCK TIMER',

      '<!> Auto lock timer button is working different than the the expected <!>'
    );
  });

  it("should check if currency button it's being shown and working correctly", async () => {
    const currrencyButton = await uiWebDriver.findElement(
      By.id('currency-btn')
    );

    assert.ok(
      typeof currrencyButton === 'object',
      '<!> Cannot find currency button <!>'
    );

    await uiWebDriver.clickElement('#your-keys-btn');
    const findFiatCurrencyTitle = await uiWebDriver.findElement(
      By.id('auto-lock-timer-title')
    );
    const fiatCurrencyText = await findFiatCurrencyTitle.getText();
    assert.equal(
      fiatCurrencyText,
      'FIAT CURRENCY',

      '<!> currency button is working different than the the expected <!>'
    );
  });

  it("should check if wallet seed phrase button it's being shown and working correctly", async () => {
    const seedPhraseButton = await uiWebDriver.findElement(
      By.id('seed-phrase-menu-btn')
    );

    assert.ok(
      typeof seedPhraseButton === 'object',
      '<!> Cannot find wallet seed phrase button <!>'
    );

    await uiWebDriver.clickElement('#seed-phrase-menu-btn');
    const findWalletSeedPhraseTitle = await uiWebDriver.findElement(
      By.id('seed-phrase-title')
    );
    const walletSeedPhraseText = await findWalletSeedPhraseTitle.getText();
    assert.equal(
      walletSeedPhraseText,
      'WALLET SEED PHRASE',

      '<!> wallet seed phrase button is working different than the the expected <!>'
    );
  });

  it("should check if info/help button it's being shown and working correctly", async () => {
    const infoHelpButton = await uiWebDriver.findElement(
      By.id('info-help-btn')
    );

    assert.ok(
      typeof infoHelpButton === 'object',
      '<!> Cannot find info/help button <!>'
    );

    await uiWebDriver.clickElement('#info-help-btn');
    const findInfoHelpTitle = await uiWebDriver.findElement(
      By.id('infor-help-title')
    );
    const infoHelpText = await findInfoHelpTitle.getText();
    assert.equal(
      infoHelpText,
      'INFO & HELP',

      '<!> info/help button is working different than the the expected <!>'
    );
  });

  it("should check if delete wallet button it's being shown and working correctly", async () => {
    const infoHelpButton = await uiWebDriver.findElement(
      By.id('delete-wallet-btn')
    );

    assert.ok(
      typeof infoHelpButton === 'object',
      '<!> Cannot find delete wallet button <!>'
    );

    await uiWebDriver.clickElement('#delete-wallet-btn');
    const findDeleteTitle = await uiWebDriver.findElement(
      By.id('infor-help-title')
    );
    const deleteText = await findDeleteTitle.getText();
    assert.equal(
      deleteText,
      'DELETE WALLET',

      '<!> delete wallet button is working different than the the expected <!>'
    );
  });
});

//   it('should check if the seed phrase shown is the same as the one applied to import the wallet', async () => {
//     setTimeout(async () => {
//       await driver.clickElement('#settings-btn');
//     }, 2000);
//     await driver.clickElement('#seed-phrase-menu-btn');
//     await driver.fill('#phraseview_password', CONSTANTS.PASSWORD);
//     const findSeedPhrase = await driver.findAllElementsWithId('user-phrase');
//     if (findSeedPhrase) {
//       console.log('the seed phrase shown is correct');
//     } else {
//       console.log('the seed phrase shown is NOT correct');
//     }
//     driver.quit();
//   });

//   it('should delete wallet after import wallet', async () => {
//     setTimeout(async () => {
//       await driver.clickElement('#settings-btn');
//     }, 2000);
//     await driver.clickElement('#delete-wallet-btn');
//     await driver.fill('#delete_password', CONSTANTS.PASSWORD);

//     if (accounts[0].balance > 0) {
//       await driver.fill('#delete_seed', CONSTANTS.IMPORT_WALLET);
//     }
//     await driver.clickElement('#delete-btn');

//     const findGetStarted = await driver.findElement(
//       By.xpath("//*[text()='Get started']")
//     );
//     if (findGetStarted) {
//       console.log('DeleteWallet is working correctly');
//     } else {
//       console.log('DeleteWallet is NOT working correctly');
//     }
//   });
// });
