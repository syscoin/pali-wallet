import { By, until } from 'selenium-webdriver';

import { buildWebDriver, Driver } from './driver';
import { importWallet } from './initialize';

describe('Home', () => {
  let driver: Driver;

  beforeAll(() => {
    jest.setTimeout(60000);
  });

  beforeEach(async () => {
    try {
      const buildResult = await buildWebDriver();
      driver = buildResult.driver;

      await driver.navigate();

      await importWallet(driver);
    } catch (error) {
      console.error('Error in beforeEach:', error);
      throw error;
    }
  });

  afterEach(async () => {
    try {
      if (driver) {
        await driver.quit();
      }
    } catch (error) {
      console.error('Error in afterEach:', error);
      throw error;
    }
  });

  it('should show balance after unlocking wallet and setting password', async () => {
    try {
      const balance = await driver.findElement(By.id('home-balance'));
      await driver.wait(until.elementIsVisible(balance));

      const balanceValueText = await balance.getAttribute('textContent');
      const balanceValue = Number.parseFloat(balanceValueText);

      const fitatAmount = await driver.findElement(By.id('fiat-ammount'));
      await driver.wait(until.elementIsVisible(fitatAmount));

      const fiatValueText = await balance.getAttribute('textContent');
      const fiatAmountValue = Number.parseFloat(fiatValueText);

      expect(typeof balanceValue).toBe('number');
      expect(isNaN(balanceValue)).toBe(false);
      expect(typeof fiatAmountValue).toBe('number');
      expect(isNaN(fiatAmountValue)).toBe(false);
    } catch (error) {
      console.error('Error in test:', error);
      throw error;
    }
  });

  it('it should verify if all buttons are correctly rendered', async () => {
    try {
      const button1 = await driver.findElement(
        By.id('headlessui-menu-button-1')
      );
      await driver.wait(until.elementIsVisible(button1));
      const button2 = await driver.findElement(
        By.id('headlessui-menu-button-2')
      );
      await driver.wait(until.elementIsVisible(button2));
      const button3 = await driver.findElement(By.id('send-btn'));
      await driver.wait(until.elementIsVisible(button3));
      const button4 = await driver.findElement(By.id('receive-btn'));
      await driver.wait(until.elementIsVisible(button4));
      const button5 = await driver.findElement(By.id('assets-btn'));
      await driver.wait(until.elementIsVisible(button5));
      const button6 = await driver.findElement(By.id('activity-btn'));
      await driver.wait(until.elementIsVisible(button6));

      expect(button1).toBeDefined();
      expect(button2).toBeDefined();
      expect(button3).toBeDefined();
      expect(button4).toBeDefined();
      expect(button5).toBeDefined();
      expect(button6).toBeDefined();
    } catch (error) {
      console.error('Error in test:', error);
      throw error;
    }
  });
});
