import assert from 'assert';

import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Send screen tests', () => {
  let uiWebDriver: Driver;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
  });

  afterEach(async () => {
    await uiWebDriver.quit();
  });

  it('should check send button', async () => {
    //  * find send btn
    const sendButton = await uiWebDriver.findElement(By.id('send-btn'));

    assert.ok(sendButton, '<!> Cannot find Send button <!>');
    //  * go to send page
    await uiWebDriver.clickElement('#send-btn');

    const findSendSYS = await uiWebDriver.findElement(By.id('sendSYS-title'));
    const sendSYSText = await findSendSYS.getText();

    assert.equal(
      sendSYSText,
      'SEND SYS',
      '<!> Send button is working different than the the expected <!>'
    );
  });

  it('should check send form', async () => {
    //  * go to send page
    await uiWebDriver.clickElement('#send-btn');
    const sendForm = await uiWebDriver.findElement(By.id('send-form'));
    assert.ok(sendForm, '<!> Cannot find send form <!>');
  });

  /**
   * we can move this test to test the error report when
   * a transaction fails using sysmint/bridge
   */

  // it("should return an amount error", async () => {
  //   await uiWebDriver.fill(
  //     "#receiver-input",
  //     "sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax"
  //   );
  //   await uiWebDriver.fill("#amount-input", "1000000000000");
  //   await uiWebDriver.clickElement("#next-btn");

  //   const confirmRoute = await uiWebDriver.findElement(By.id("send-confirm"));

  //   assert.ok(
  //     typeof confirmRoute === "object",
  //     "<!> Cannot find send confirm route <!>"
  //   );

  //   await uiWebDriver.clickElement("#confirm-btn");

  //   const checkModalError = await uiWebDriver.findElement(By.id("modal-alert"));

  //   assert.ok(
  //     typeof checkModalError === "object",
  //     "<!> Cannot find modal error <!>"
  //   );
  // });
});
