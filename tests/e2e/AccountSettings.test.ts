import assert from 'assert';

import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Account settings tests', () => {
  let uiWebDriver: Driver;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach(async () => {
    await uiWebDriver.quit();
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

    // go to create new account
    await uiWebDriver.clickElement('#create-new-account-btn');
    await uiWebDriver.fill('#account-name-input', 'Account 2');

    // create new account
    await uiWebDriver.clickElement('#create-btn');
    await uiWebDriver.clickElement('#got-it-btn');

    // go home and open the menu again
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#accounts-btn');

    // switch account
    await uiWebDriver.clickElement('#account-1');
    const accountLabel = await uiWebDriver.findElement('#active-account-label');

    // check if Account 2 is the active one
    const activeAccountLabelText = await accountLabel.getText();
    expect(activeAccountLabelText).toBe('Account 2');
  });

  /*
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
    expect(url).toContain(expectedUrl);
  }); */
});
