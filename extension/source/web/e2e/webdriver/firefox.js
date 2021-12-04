const fs = require('fs');
const os = require('os');
const path = require('path');
const { Builder, By, until } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const { version } = require('../../package.json');

const TEMP_PROFILE_PATH_PREFIX = path.join(os.tmpdir(), 'pali wallet');
class FirefoxDriver {

  static async build({ responsive, port }) {
    const templateProfile = fs.mkdtempSync(TEMP_PROFILE_PATH_PREFIX);
    const options = new firefox.Options().setProfile(templateProfile);
    const builder = new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options);
    if (port) {
      const service = new firefox.ServiceBuilder().setPort(port);
      builder.setFirefoxService(service);
    }
    const driver = builder.build();
    const fxDriver = new FirefoxDriver(driver);

    const extensionId = await fxDriver.installExtension(
      `builds/paliwallet-firefox-${version}.zip`,
    );
    const internalExtensionId = await fxDriver.getInternalId();

    if (responsive) {
      await driver.manage().window().setRect({ width: 320, height: 600 });
    }

    return {
      driver,
      extensionId,
      extensionUrl: `moz-extension://${internalExtensionId}`,
    };
  }


  constructor(driver) {
    this._driver = driver;
  }

  async installExtension(addonPath) {
    return await this._driver.installAddon(addonPath, true);
  }

  async getInternalId() {
    await this._driver.get('about:debugging#addons');
    return await this._driver
      .wait(
        until.elementLocated(By.xpath("//dl/div[contains(., 'UUID')]/dd")),
        1000,
      )
      .getText();
  }
}

module.exports = FirefoxDriver;
