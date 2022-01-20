import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';
import { storeState } from '../../../source/state/store';

describe('Receive screen tests', async () => {
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

  it('should check if receive qr code is being shown', async () => {
    const qrCode = await uiWebDriver.findElement(By.id('qr-code'));

    assert.ok(typeof qrCode === 'object', '<!> Cannot find QRcode <!>');
  });

  it("should check if receive copy address button it's being shown and working correctly", async () => {
    const copyAddresBtn = await uiWebDriver.findElement(
      By.id('copy-address-receive-btn')
    );

    assert.ok(
      typeof copyAddresBtn === 'object',
      '<!> Cannot find receive copy address button <!>'
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
});
