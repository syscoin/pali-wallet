import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';

describe('Account settings tests', async () => {
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

  it('should check account settings button', async () => {
    const settingsButton = await uiWebDriver.findElement(
      By.id('account-settings-btn')
    );

    assert.ok(settingsButton, '<!> Cannot find settings button <!>');
  });

  it('should switch account', async () => {
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#accounts-btn');
    //  * go to create new account
    await uiWebDriver.clickElement('#create-new-account-btn');
    await uiWebDriver.fill('#account-name-input', 'Account 2');
    //  * create new account
    await uiWebDriver.clickElement('#create-btn');
    await uiWebDriver.clickElement('#got-it-btn');
    //  * go home and open the menu again
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#accounts-btn');
    //  * switch account
    await uiWebDriver.clickElement('#account-1');
    await uiWebDriver.clickElement('#accounts-btn');
    const account2Btn = await uiWebDriver.findElement('#account-1');
    const account2BtnText = await account2Btn.getText();
    //  * check if Account 2 is the active one
    assert.equal(
      account2BtnText,
      'Account 2 (active)',
      '<!> switch account is not working <!>'
    );
  });

  it('should open the trezor popup in a new tab', async () => {
    await uiWebDriver.clickElement('#account-settings-btn');
    //  * go to hardware wallet
    await uiWebDriver.clickElement('#hardware-wallet-btn');
    //  * select Trezor
    await uiWebDriver.clickElement('#trezor-btn');
    //  * connect
    await uiWebDriver.clickElement('#connect-btn');
    try {
      await uiWebDriver.switchToWindowWithTitle('TrezorConnect | Trezor', null);
    } catch (error) {
      assert.ifError(error);
    }
    const url = await uiWebDriver.getCurrentUrl();
    const expectedUrl = 'https://connect.trezor.io/8/popup.html';
    //    * check if this is being redirected to https://connect.trezor.io/8/popup.html
    assert.equal(url, expectedUrl, '<!> pali is not opening trezor popup <!>');
  });
});
