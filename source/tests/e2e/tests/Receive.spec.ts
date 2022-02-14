import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';
import { currentWalletState } from '../../../state/store';

describe('<Receive /> tests', async () => {
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

  it('should check if receive button is being shown and working correctly', async () => {
    //   * find receive btn
    const receiveButton = await uiWebDriver.findElement(By.id('receive-btn'));

    assert.ok(
      // eslint-disable-next-line valid-typeof
      typeof receiveButton !== null,
      '<!> Cannot find receive button <!>'
    );

    await uiWebDriver.clickElement('#receive-btn');
    //  * find receive page title
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

  it('should check if receive qr code is being shown', async () => {
    //  * go to receive page
    await uiWebDriver.clickElement('#receive-btn');
    //  * fin qr Code
    const qrCode = await uiWebDriver.findElement(By.id('qr-code'));

    assert.ok(typeof qrCode === 'object', '<!> Cannot find QRcode <!>');
  });

  it("should check if receive copy address button it's being shown and working correctly", async () => {
    //  * go to receive page
    await uiWebDriver.clickElement('#receive-btn');
    //  * find copy address btn
    const copyAddresBtn = await uiWebDriver.findElement(
      By.id('copy-address-receive-btn')
    );

    assert.ok(
      // eslint-disable-next-line valid-typeof
      typeof copyAddresBtn !== null,
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
