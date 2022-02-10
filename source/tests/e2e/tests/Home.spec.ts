import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from '../webdriver';
import { importWallet } from '../initialize';
import { SYS_EXPLORER_SEARCH } from '../../../constants/index';
import { currentWalletState } from '../../../state/store';

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

  it('should check if it is opening tx details on explorer correctly', async () => {
    const isTestnet =
      SYS_EXPLORER_SEARCH === 'https://blockbook-dev.elint.services/';

    await uiWebDriver.openNewPage(
      `${SYS_EXPLORER_SEARCH}/tx/13609476ca9568999481a868243602608d08797a3447ddc5298e787df94871ce`
    );

    const windowTitle = await uiWebDriver.getTitle();

    assert.equal(
      windowTitle,
      isTestnet ? 'Trezor Syscoin Testnet Explorer' : 'Trezor Syscoin Explorer'
    );
  });

  it('should show balance correctly', async () => {
    const balance = await uiWebDriver.findElement(By.id('home-balance'));

    const { accounts, activeAccountId } = currentWalletState;

    if (accounts[activeAccountId]) {
      const balanceValue = await balance.getText();
      const expectedBalance = String(accounts[activeAccountId].balance);

      assert.equal(
        balanceValue,
        expectedBalance,
        '<!> Balance different than the expected <!>'
      );
    }
  });
});
