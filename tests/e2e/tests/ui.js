import { importWallet } from '../initialize';
import { buildWebDriver } from '../webdriver';

describe('ui tests', () => {
  it('should change network to testnet after login', async () => {
    const { driver } = await buildWebDriver();

    await importWallet();

    console.log('lasdmaskn');

    driver.quit();
  });
});
