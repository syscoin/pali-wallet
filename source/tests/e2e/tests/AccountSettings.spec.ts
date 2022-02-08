import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';
import { currentWalletState } from '../../../state/store';

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

  it('should check if account settings button is being shown', async () => {
    const settingsButton = await uiWebDriver.findElement(
      By.id('account-settings-btn')
    );

    assert.ok(
      typeof settingsButton === 'object',
      '<!> Cannot find settings button <!>'
    );
  });

  it('should check if switch account is working correctly', async () => {
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#accounts-btn');
    await uiWebDriver.clickElement('#create-new-account-btn');
    await uiWebDriver.fill('#account-name-input', 'Account 2');
    await uiWebDriver.clickElement('#create-btn');
    await uiWebDriver.clickElement('#got-it-btn');
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#accounts-btn');
    await uiWebDriver.clickElement('#account-1');
    const { accounts, activeAccountId } = currentWalletState;
    assert.equal(
      accounts[activeAccountId],
      1,
      '<!> switch account is not working <!>'
    );
  });

  it('should check if pali is opening the trezor popup correctly in a new tab', async () => {
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#hardware-wallet-btn');
    await uiWebDriver.clickElement('#trezor-btn');
    await uiWebDriver.clickElement('#connect-btn');
    /* const url = uiWebDriver.getCurrentUrl();
    const expectedUrl = 'https://connect.trezor.io/8/popup.html#';
    assert.equal(url, expectedUrl, '<!> pali is not opening trezor popup <!>'); */
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
