import { Browser } from 'selenium-webdriver';

import { Driver } from './driver';
import ChromeDriver from './chrome';
import FirefoxDriver from './firefox';

export { Driver } from './driver';

async function buildBrowserWebDriver(browser, webDriverOptions) {
  switch (browser) {
    case Browser.FIREFOX:
      return FirefoxDriver.build(webDriverOptions);
    default:
    case Browser.CHROME:
      return ChromeDriver.build(webDriverOptions);
  }
}

export async function buildWebDriver(): Promise<{
  driver: Driver;
  extensionId;
}> {
  const browser = process.env.SELENIUM_BROWSER;

  const {
    driver: seleniumDriver,
    extensionId,
    extensionUrl,
  } = await buildBrowserWebDriver(browser, {});
  const driver = new Driver(seleniumDriver, browser, extensionUrl);

  return {
    driver,
    extensionId,
  };
}
