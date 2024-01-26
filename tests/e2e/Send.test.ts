import assert from 'assert';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Send', () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = (await buildWebDriver()).driver;

    await driver.navigate();
    await importWallet(driver);
  });

  afterEach(async () => {
    await driver.quit();
  });

  it('should check send button', async () => {
    //  * find send btn
    const sendButton = await driver.findElement(By.id('send-btn'));

    assert.ok(sendButton, '<!> Cannot find Send button <!>');
    //  * go to send page
    await driver.clickElement('#send-btn');

    const balanceTextElement = await driver.findElement(By.id('balance-text'));

    const balanceText = await balanceTextElement.getText();

    assert.ok(
      balanceText.includes('Balance'),
      'Balance text is not as expected'
    );
  });

  it('should check send form', async () => {
    //  * go to send page
    await driver.clickElement('#send-btn');
    const sendForm = await driver.findElement(By.id('send-form'));
    assert.ok(sendForm, '<!> Cannot find send form <!>');
  });
});
