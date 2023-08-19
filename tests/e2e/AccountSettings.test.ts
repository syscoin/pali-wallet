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

  it('should find account settings', async () => {
    const settingsButton = await driver.findElement(
      By.id('general-settings-button')
    );

    assert.ok(settingsButton, '<!> Cannot find settings button <!>');
  });

  it('should switch account and verify settings buttons', async () => {
    await driver.clickElement('#general-settings-button');

    await driver.clickElement('#create-new-account');

    await driver.fill('#account-name-input', 'Account 2');

    await driver.clickElement('#create-btn');

    await driver.clickElement('#got-it-btn');

    await driver.clickElement('#general-settings-button');

    const activeAccountLabel = await driver.findElement(By.id('account-1'));

    if (!activeAccountLabel) {
      throw new Error('Active account label not found');
    }

    const activeAccountLabelText = await activeAccountLabel.getAttribute(
      'innerText'
    );

    console.log('activeAccountLabelText', activeAccountLabelText);
    expect(activeAccountLabelText).toContain('Account 2');
  });
});
