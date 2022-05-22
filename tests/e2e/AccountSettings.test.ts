import assert from 'assert';

import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Account settings', () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = (await buildWebDriver()).driver;

    await driver.navigate();
    await importWallet(driver);
  });

  afterEach(async () => {
    await driver.quit();
  });

  it('should find account settings button', async () => {
    const settingsButton = await driver.findElement(
      By.id('account-settings-btn')
    );

    assert.ok(settingsButton, '<!> Cannot find settings button <!>');
  });

  it('should switch account', async () => {
    await driver.clickElement('#account-settings-btn');
    await driver.clickElement('#accounts-btn');

    // go to create new account
    await driver.clickElement('#create-new-account-btn');
    await driver.fill('#account-name-input', 'Account 2');

    // create new account
    await driver.clickElement('#create-btn');
    await driver.clickElement('#got-it-btn');

    // go home and open the menu again
    await driver.clickElement('#account-settings-btn');
    await driver.clickElement('#accounts-btn');

    // switch account
    await driver.clickElement('#account-1');
    const accountLabel = await driver.findElement('#active-account-label');

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
