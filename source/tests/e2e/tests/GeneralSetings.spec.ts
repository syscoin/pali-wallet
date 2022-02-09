import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';
import clipboard from 'clipboardy';

import { FAKE_PASSWORD, FAKE_SEED_PHRASE } from '../../../constants/tests';
import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';

describe('General settings tests', async () => {
  let uiWebDriver: Driver;

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
    const currentClipboard = clipboard.read();
    const expectedClipboard = FAKE_SEED_PHRASE;
    assert.equal(
      currentClipboard,
      expectedClipboard,
      '<!> copy wallet seed phrase is working correctly <!>'
    );
  });

  it('should check if pali is opening a new tab to redirect the user to syscoin discord for support', async () => {
    await uiWebDriver.clickElement('#general-settings-button');
    await uiWebDriver.clickElement('#info-help-btn');
    await uiWebDriver.clickElement('#user-support-btn');
    try {
      await uiWebDriver.switchToWindowWithTitle('Syscoin', null);
    } catch (error) {
      assert.ifError(error);
    }
    const url = uiWebDriver.getCurrentUrl();
    const expectedUrl = 'https://discord.gg/8QKeyurHRd';
    assert.equal(
      url,
      expectedUrl,
      '<!> pali is not opening syscoin discord invite <!>'
    );
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
