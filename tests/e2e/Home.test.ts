import { By } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Home', () => {
  let driver: Driver;

  beforeEach(async () => {
    driver = (await buildWebDriver()).driver;

    await driver.navigate();
    await importWallet(driver);
  });

  afterEach(async () => {
    await driver.quit();
  });

  it('should show balance', async () => {
    // find balance
    const balance = await driver.findElement(By.id('home-balance'));
    const balanceValue = Number.parseFloat(await balance.getText());

    expect(typeof balanceValue).toBe('number');
  });
});
