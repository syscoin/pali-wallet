import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By, until } from 'selenium-webdriver';

describe('Account settings tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });

    const settingsButton = await uiWebDriver.findElement(
      By.id('account-settings-btn')
    );

    assert.ok(
      typeof settingsButton === 'object',
      '<!> Cannot find settings button <!>'
    );

    await uiWebDriver.clickElement('#account-settings-btn');
  });

  afterEach((done) => {
    done();

    uiWebDriver.quit();
  });

  // it("should check if switch account is working correctly", async () => {
  //   /**
  //    * go to create account
  //    * create new account
  //    * go home and open menu again
  //    * switch accounts
  //    *
  //    * you can check the address to compare if they are different
  //    * when changing the active account
  //    */
  // });

  // it("should check if pali is opening the trezor popup correctly in a new tab", async () => {
  //   /**
  //    * go to hardware wallet
  //    * select trezor
  //    * click on connect
  //    *
  //    * it is expected that pali opens a new tab
  //    * https://connect.trezor.io/8/popup.html#
  //    */
  // });
});
