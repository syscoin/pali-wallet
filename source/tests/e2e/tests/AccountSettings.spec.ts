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
    if (accounts[activeAccountId]) {
      const activeId = accounts[activeAccountId].id;
      assert.equal(activeId, 1, '<!> switch account is not working <!>');
    }
  });

  it('should check if pali is opening the trezor popup correctly in a new tab', async () => {
    await uiWebDriver.clickElement('#account-settings-btn');
    await uiWebDriver.clickElement('#hardware-wallet-btn');
    await uiWebDriver.clickElement('#trezor-btn');
    await uiWebDriver.clickElement('#connect-btn');
    try {
      await uiWebDriver.switchToWindowWithTitle('TrezorConnect | Trezor', null);
    } catch (error) {
      assert.ifError(error);
    }
    const url = await uiWebDriver.getCurrentUrl();
    const expectedUrl = 'https://connect.trezor.io/8/popup.html';
    assert.equal(url, expectedUrl, '<!> pali is not opening trezor popup <!>');
  });
});
