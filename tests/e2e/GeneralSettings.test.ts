import assert from 'assert';

import { By } from 'selenium-webdriver';
import clipboard from 'copy-paste';

import { MOCK_PASSWORD, MOCK_SEED_PHRASE } from '../mocks';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('General settings', () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = (await buildWebDriver()).driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach(async () => {
    await driver.quit();
  });

  it('should check general settings button ', async () => {
    const generalSettingsButton = await driver.findElement(
      By.id('general-settings-button')
    );

    expect(generalSettingsButton).toBeTruthy();
  });

  it('should display the correct seed', async () => {
    await driver.clickElement('#general-settings-button');

    // go to wallet seed phrase
    await driver.clickElement('#wallet-seed-phrase-btn');

    // input password
    await driver.fill('#phraseview_password', MOCK_PASSWORD);
    await driver.clickElement('#copy-btn');

    const clipboardValue = clipboard.paste();
    expect(clipboardValue).toBe(MOCK_SEED_PHRASE);
  });

  it('should open a new tab to redirect the user to syscoin discord for support', async () => {
    await driver.clickElement('#general-settings-button');

    // go to info/help
    await driver.clickElement('#info-help-btn');

    // open the discord invite in a new tab
    await driver.clickElement('#user-support-btn');

    try {
      await driver.switchToWindowWithTitle('Syscoin', null);
    } catch (error) {
      assert.ifError(error);
    }

    const url = await driver.getCurrentUrl();
    const expectedUrl = 'https://discord.com/invite/8QKeyurHRd';

    expect(url).toBe(expectedUrl);
  });
});
