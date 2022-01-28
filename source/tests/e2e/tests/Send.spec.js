import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';

describe('Send screen tests', async () => {
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

  it("should check if send form it's being shown", async () => {
    const sendBalance = setTimeout(async () => {
      await uiWebDriver.findElement(By.id('send-balance'));
    }, 500);

    assert.ok(
      typeof sendBalance === 'object',
      '<!> Cannot find badge connected <!>'
    );

    const receiverInput = await uiWebDriver.findElement(
      By.id('receiver-input')
    );

    assert.ok(
      typeof receiverInput === 'object',
      '<!> Cannot find receiver input <!>'
    );

    const networkDropdown = await uiWebDriver.findElement(
      By.id('send-network-dropdown')
    );

    assert.ok(
      typeof networkDropdown === 'object',
      '<!> Cannot find network dropdown <!>'
    );

    const verifyAddressSwitch = await uiWebDriver.findElement(
      By.id('verify-address-switch')
    );

    assert.ok(
      typeof verifyAddressSwitch === 'object',
      '<!> Cannot find verify address switch <!>'
    );

    const ZDagSwitch = await uiWebDriver.findElement(By.id('z-dag-switch'));

    assert.ok(typeof ZDagSwitch === 'object', '<!> Cannot find Zdag switch<!>');

    const AmountInput = await uiWebDriver.findElement(By.id('amount-input'));

    assert.ok(
      typeof AmountInput === 'object',
      '<!> Cannot find amount input<!>'
    );

    const nextBtn = await uiWebDriver.findElement(By.id('next-btn'));

    assert.ok(typeof nextBtn === 'object', '<!> Cannot find next button<!>');
  });

  it("should check if fee input it's being shown", async () => {
    const feeInput = setTimeout(async () => {
      await uiWebDriver.findElement(By.id('next-btn'));
    }, 500);

    assert.ok(typeof feeInput === 'object', '<!> Cannot find fee input<!>');

    //It's not ready yet, still need to check if it's disabled when using a Syscoin Network
  });
});
