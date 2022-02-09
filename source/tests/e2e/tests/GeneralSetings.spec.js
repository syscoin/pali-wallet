import assert from 'assert';
import { FAKE_PASSWORD } from '../../../constants/index';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { FAKE_PASSWORD } from '../../../constants/tests';
import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';

describe('General settings tests', async () => {
  let uiWebDriver;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach((done) => {
    done();

    uiWebDriver.quit();
  });

  it('should check if general settings button is being shown', async () => {
    const generalSettingsButton = await uiWebDriver.findElement(
      By.id('general-settings-button')
    );

    assert.ok(
      typeof generalSettingsButton === 'object',
      '<!> Cannot find general settings button <!>'
    );
  });

  it('should check if pali is showing the correct seed phrase after input the password', async () => {
    await uiWebDriver.clickElement('#general-settings-button');
    await uiWebDriver.clickElement('#wallet-seed-phrase-btn');
    await uiWebDriver.fill('#phraseview_password', FAKE_PASSWORD);
    await uiWebDriver.clickElement('#copy-btn');
    // Descobrir como verificar o q está no clipboard
    // Checar se o q está no clipboard é igual a FAKE_SEED_PHRASE
  });

  it('should check if pali is opening a new tab to redirect the user to syscoin discord for support', async () => {
    await uiWebDriver.clickElement('#general-settings-button');
    await uiWebDriver.clickElement('#info-help-btn');
    await uiWebDriver.clickElement('#user-support-btn');
    /* const url = uiWebDriver.getCurrentUrl();
    const expectedUrl = 'https://discord.gg/8QKeyurHRd';
    assert.equal(url, expectedUrl, '<!> pali is not opening trezor popup <!>'); */
  });
});
// it("should check if pali is showing the correct seed phrase after input the password", async () => {
//   /**
//    * go to wallet seed phrase
//    * input password
//    * call getPhrase(pwd)
//    * check if it is copying correctly after click on element
//    */
// });

// it("should check if pali is opening a new tab to redirect the user to syscoin discord for support", async () => {
//   /**
//    * go to info/help
//    * click on element to open the discord invite in a new tab
//    * https://discord.com/invite/8QKeyurHRd
//    */
// });
