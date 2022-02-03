import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';

describe('<Send /> tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });

    const sendButton = await uiWebDriver.findElement(By.id('send-btn'));

    assert.ok(
      typeof sendButton === 'object',
      '<!> Cannot find Send button <!>'
    );

    await uiWebDriver.clickElement('#send-btn');

    const findSendSYS = await uiWebDriver.findElement(By.id('sendSYS-title'));
    const sendSYSText = await findSendSYS.getText();

    assert.equal(
      sendSYSText,
      'SEND SYS',
      '<!> Send button is working different than the the expected <!>'
    );
  });

  afterEach((done) => {
    done();

    uiWebDriver.quit();
  });

  it("should check if send form it's being shown", async () => {
    const sendBalance = await uiWebDriver.findElement(By.id('send'));

    assert.ok(typeof sendBalance === 'object', '<!> Cannot find send form <!>');
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
