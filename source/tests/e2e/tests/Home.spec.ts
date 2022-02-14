import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';
import { SYS_EXPLORER_SEARCH } from '../../../constants/index';

describe('<Home /> tests', async () => {
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

  it('should open tx details on explorer', async () => {
    const isTestnet =
      SYS_EXPLORER_SEARCH === 'https://blockbook-dev.elint.services/';
    //  * open sys explorer
    await uiWebDriver.openNewPage(
      `${SYS_EXPLORER_SEARCH}/tx/13609476ca9568999481a868243602608d08797a3447ddc5298e787df94871ce`
    );

    const windowTitle = await uiWebDriver.getTitle();
    //  * check if window title corresponds to tesstnet window title
    assert.equal(
      windowTitle,
      isTestnet ? 'Trezor Syscoin Testnet Explorer' : 'Trezor Syscoin Explorer'
    );
  });

  it('should show balance', async () => {
    //  * find balance
    const balance = await uiWebDriver.findElement(By.id('home-balance'));
    const balanceValue = await balance.getText();

    //  * check if balance received is a number
    assert.ok(
      typeof balanceValue === 'number',
      '<!> Balance different than the expected <!>'
    );
  });
});
