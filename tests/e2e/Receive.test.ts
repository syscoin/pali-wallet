import assert from 'assert';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Receive', () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = (await buildWebDriver()).driver;

    await driver.navigate();
    await importWallet(driver);
  });

  afterEach(async () => {
    await driver.quit();
  });

  it('should check receive button', async () => {
    // find receive btn
    const receiveButton = await driver.findElement(By.id('receive-btn'));

    assert.ok(receiveButton, '<!> Cannot find receive button <!>');

    await driver.clickElement('#receive-btn');
    // find receive page title
    const findReceiveSYS = await driver.findElement(By.id('receiveSYS-title'));
    const receiveSYSText = await findReceiveSYS.getText();

    assert.equal(
      receiveSYSText,
      'RECEIVE SYS',
      '<!> Receive button is working different than the expected <!>'
    );
  });

  it('should check receive qr code', async () => {
    // go to receive page
    await driver.clickElement('#receive-btn');

    // find qrcode
    const qrCode = await driver.findElement(By.id('qr-code'));

    assert.ok(qrCode, '<!> Cannot find QRcode <!>');
  });

  it('should copy the receive address', async () => {
    // go to receive page
    await driver.clickElement('#receive-btn');

    // find copy address btn
    const copyAddresBtn = await driver.findElement(
      By.id('copy-address-receive-btn')
    );

    assert.ok(copyAddresBtn, '<!> Cannot find receive copy address button <!>');
  });
});
