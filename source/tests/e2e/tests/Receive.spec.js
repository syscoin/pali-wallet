import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';
import { currentWalletState } from '../../../../source/state/store';

describe('<Receive /> tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });

    const receiveButton = await uiWebDriver.findElement(By.id('receive-btn'));

    assert.ok(
      typeof receiveButton === 'object',
      '<!> Cannot find receive button <!>'
    );

    await uiWebDriver.clickElement('#receive-btn');

    const findReceiveSYS = await uiWebDriver.findElement(
      By.id('receiveSYS-title')
    );
    const receiveSYSText = await findReceiveSYS.getText();

    assert.equal(
      receiveSYSText,
      'RECEIVE SYS',
      '<!> Receive button is working different than the the expected <!>'
    );
  });

  afterEach((done) => {
    done();

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

    const { accounts, activeAccountId } = currentWalletState;

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
