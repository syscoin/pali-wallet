import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';
import { storeState } from '../../../source/state/store';

describe('<Home /> tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach(() => {
    uiWebDriver.quit();
  });

  it('should show balance correctly', async () => {
    const balance = await uiWebDriver.findElement(By.id('home-balance'));

    const { accounts, activeAccountId } = storeState.wallet;
    if (accounts[activeAccountId]) {
      const balanceValue = await balance.getText();
      const expectedBalance = accounts[activeAccountId].balance;

      assert.equal(
        balanceValue,
        expectedBalance,
        '<!> Balance different than the expected <!>'
      );
    }
  });

  /*it("should check if send button its being shown and working correctly", async () => {
    const sendButton = await uiWebDriver.findElement(By.id("send-btn"));

    assert.ok(
      typeof sendButton === "object",
      "<!> Cannot find Send button <!>"
    );

    await uiWebDriver.clickElement("#send-btn");
    const findSendSYS = await uiWebDriver.findElement(By.id("sendSYS-title"));
    const sendSYSText = await findSendSYS.getText();
    assert.equal(
      sendSYSText,
      "SEND SYS",

      "<!> Send button is working different than the the expected <!>"
    );
  });

  it("should check if receive button it's being shown and working correctly", async () => {
    const receiveButton = await uiWebDriver.findElement(By.id("receive-btn"));

    assert.ok(
      typeof receiveButton === "object",
      "<!> Cannot find receive button <!>"
    );

    await uiWebDriver.clickElement("#receive-btn");
    const findReceiveSYS = await uiWebDriver.findElement(
      By.id("receiveSYS-title")
    );
    const receiveSYSText = await findReceiveSYS.getText();
    assert.equal(
      receiveSYSText,
      "receive SYS",

      "<!> Receive button is working different than the the expected <!>"
    );
  });*/

  it("should check if copy address button it's being shown and working correctly", async () => {
    const copyAddresBtn = await uiWebDriver.findElement(
      By.id('copy-address-btn')
    );

    assert.ok(
      typeof copyAddresBtn === 'object',
      '<!> Cannot find copy address button <!>'
    );

    const { accounts, activeAccountId } = storeState.wallet;
    if (accounts[activeAccountId]) {
      const copyAddresValue = await copyAddresBtn.getAttribute('value');
      const expectedValue = accounts[activeAccountId].address;

      assert.equal(
        copyAddresValue,
        expectedValue,
        '<!> Address different than the expected <!>'
      );
    }
  });

  it("should check if general settings button it's being shown and working correctly", async () => {
    const settingsButton = await uiWebDriver.findElement(By.id('settings-btn'));

    assert.ok(
      typeof settingsButton === 'object',
      '<!> Cannot find settings button <!>'
    );

    await uiWebDriver.clickElement('#settings-btn');
    const findGeneralSettings = await uiWebDriver.findElement(
      By.id('general-settings-title')
    );
    const generalSettingsText = await findReceiveSYS.getText();
    assert.equal(
      generalSettingsText,
      'GENERAL SETTINGS',

      '<!> General settings button is working different than the the expected <!>'
    );
  });

  it("should check if network settings button it's being shown and working correctly", async () => {
    const networkSettingsButton = await uiWebDriver.findElement(
      By.id('network-settings-btn')
    );

    assert.ok(
      typeof networkSettingsButton === 'object',
      '<!> Cannot find network settings button <!>'
    );

    await uiWebDriver.clickElement('#network-settings-btn');
    const findNetworkSettings = await uiWebDriver.findElement(
      By.id('network-settings-title')
    );
    const networkSettingsText = await findNetworkSettings.getText();
    assert.equal(
      networkSettingsText,
      'NETWORK SETTINGS',

      '<!> Network settings button is working different than the the expected <!>'
    );
  });

  it("should check if account settings button it's being shown and working correctly", async () => {
    const accountSettingsButton = await uiWebDriver.findElement(
      By.id('account-settings-btn')
    );

    assert.ok(
      typeof accountSettingsButton === 'object',
      '<!> Cannot find account settings button <!>'
    );

    await uiWebDriver.clickElement('#account-settings-btn');
    const findAccountSettings = await uiWebDriver.findElement(
      By.id('account-settings-title')
    );
    const accountSettingsText = await findAccountSettings.getText();
    assert.equal(
      accountSettingsText,
      'ACCOUNT SETTINGS',

      '<!> Account settings button is working different than the the expected <!>'
    );
  });

  it("should check if connected badge it's being shown", async () => {
    const badgeConnected = await uiWebDriver.findElement(
      By.id('badge-connected-status')
    );

    assert.ok(
      typeof badgeConnected === 'object',
      '<!> Cannot find badge connected <!>'
    );
  });
});
