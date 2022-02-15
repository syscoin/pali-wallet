import assert from 'assert';

import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('<Receive /> tests', () => {
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

  it('should check receive button', async () => {
    //   * find receive btn
    const receiveButton = await uiWebDriver.findElement(By.id('receive-btn'));

    assert.ok(receiveButton, '<!> Cannot find receive button <!>');

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

  it('should check receive qr code', async () => {
    //  * go to receive page
    await uiWebDriver.clickElement('#receive-btn');
    //  * fin qr Code
    const qrCode = await uiWebDriver.findElement(By.id('qr-code'));

    assert.ok(qrCode, '<!> Cannot find QRcode <!>');
  });

  it('should check receive copy address button', async () => {
    //  * go to receive page
    await uiWebDriver.clickElement('#receive-btn');
    //  * find copy address btn
    const copyAddresBtn = await uiWebDriver.findElement(
      By.id('copy-address-receive-btn')
    );

    assert.ok(copyAddresBtn, '<!> Cannot find receive copy address button <!>');
    const copyAddresValue = await copyAddresBtn.getAttribute('value');
    if (typeof copyAddresValue === 'string' || copyAddresValue.length != 0) {
      assert.ok(copyAddresValue, '<!> Address different than the expected <!>');
    }
  });
});
