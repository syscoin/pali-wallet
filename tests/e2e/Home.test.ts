import assert from 'assert';

import { By } from 'selenium-webdriver';

import { SYS_EXPLORER_SEARCH } from '../../source/constants/index';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Home sceen tests', () => {
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
    const balanceText = await balance.getText();
    const balanceValue = Number.parseFloat(balanceText);
    //  * check if balance received is a number
    expect(typeof balanceValue).toBe('number');
  });
});
