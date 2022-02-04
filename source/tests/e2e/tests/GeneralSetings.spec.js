import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';

describe('General settings tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });

    const generalSettingsButton = await uiWebDriver.findElement(
      By.id('general-settings-button')
    );

    assert.ok(
      typeof generalSettingsButton === 'object',
      '<!> Cannot find general settings button <!>'
    );

    await uiWebDriver.clickElement('#general-settings-button');
  });

  afterEach((done) => {
    done();

    uiWebDriver.quit();
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
});
