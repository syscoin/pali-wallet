const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
class ChromeDriver {
  static async build({ responsive, port }) {
    const root = process.cwd();
    const extDir = `load-extension=${root}/extension/chrome`;
    const args = [extDir];
    if (responsive) {
      args.push('--auto-open-devtools-for-tabs');
    }
    args.push('--window-size=100,720')
    const options = new chrome.Options().addArguments(args);
    const builder = new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options);
    const service = new chrome.ServiceBuilder();

    if (process.env.ENABLE_CHROME_LOGGING !== 'false') {
      service.setStdio('inherit').enableChromeLogging();
    }
    if (port) {
      service.setPort(port);
    }
    builder.setChromeService(service);
    const driver = builder.build();
    const chromeDriver = new ChromeDriver(driver);
    const extensionId = await chromeDriver.getExtensionIdByName('Pali Wallet');

    return {
      driver,
      extensionUrl: `chrome-extension://${extensionId}`,
    };
  }

  constructor(driver) {
    this._driver = driver;
  }

  async getExtensionIdByName(extensionName) {
    await this._driver.get('chrome://extensions');
    return await this._driver.executeScript(`
      const extensions = document.querySelector("extensions-manager").shadowRoot
        .querySelector("extensions-item-list").shadowRoot
        .querySelectorAll("extensions-item")

      for (let i = 0; i < extensions.length; i++) {
        const extension = extensions[i].shadowRoot
        const name = extension.querySelector('#name').textContent
        if (name === "${extensionName}") {
          return extensions[i].getAttribute("id")
        }
      }

      return undefined
    `);
  }
}

module.exports = ChromeDriver;
