const { promises: fs } = require('fs');
const { strict: assert } = require('assert');
const { until, error: webdriverError, By } = require('selenium-webdriver');
const cssToXPath = require('css-to-xpath');


function wrapElementWithAPI(element, driver) {
  element.press = (key) => element.sendKeys(key);
  element.fill = async (input) => {
    await element.clear();
    await element.sendKeys(input);
  };
  element.waitForElementState = async (state, timeout) => {
    switch (state) {
      case 'hidden':
        return await driver.wait(until.stalenessOf(element), timeout);
      case 'visible':
        return await driver.wait(until.elementIsVisible(element), timeout);
      default:
        throw new Error(`Provided state: '${state}' is not supported`);
    }
  };
  return element;
}

class Driver {

  constructor(driver, browser, extensionUrl, timeout = 10000) {
    this.driver = driver;
    this.browser = browser;
    this.extensionUrl = extensionUrl;
    this.timeout = timeout;
    this.Key = {
      BACK_SPACE: '\uE003',
      ENTER: '\uE007',
    };
  }

  buildLocator(locator) {
    if (typeof locator === 'string') {
      return By.css(locator);
    } else if (locator.value) {
      return locator;
    } else if (locator.xpath) {
      return By.xpath(locator.xpath);
    } else if (locator.text) {
      if (locator.css) {
        const xpath = cssToXPath
          .parse(locator.css)
          .where(
            cssToXPath.xPathBuilder
              .string()
              .contains(locator.text)
              .or(
                cssToXPath.xPathBuilder
                  .string()
                  .contains(locator.text.split(' ').join('')),
              ),
          )
          .toXPath();
        return By.xpath(xpath);
      }

    }
    throw new Error(
      `The locator '${locator}' is not supported by the E2E test driver`,
    );
  }

  async fill(rawLocator, input) {
    const element = await this.findElement(rawLocator);
    await element.fill(input);
    return element;
  }

  async press(rawLocator, keys) {
    const element = await this.findElement(rawLocator);
    await element.press(keys);
    return element;
  }

  async delay(time) {
    await new Promise((resolve) => setTimeout(resolve, time));
  }

  async wait(condition, timeout = this.timeout) {
    await this.driver.wait(condition, timeout);
  }

  async actions(){
    return this.driver.actions();
  }

  async waitForSelector(
    rawLocator,
    { timeout = this.timeout, state = 'visible' } = {},
  ) {
    const selector = this.buildLocator(rawLocator);
    let element;
    if (!['visible', 'detached'].includes(state)) {
      throw new Error(`Provided state selector ${state} is not supported`);
    }
    if (state === 'visible') {
      element = await this.driver.wait(until.elementLocated(selector), timeout);
    } else if (state === 'detached') {
      element = await this.driver.wait(
        until.stalenessOf(await this.findElement(selector)),
        timeout,
      );
    }
    return wrapElementWithAPI(element, this);
  }

  async quit() {
    await this.driver.quit();
  }

  async findElement(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const element = await this.driver.wait(
      until.elementLocated(locator),
      this.timeout,
    );
    return wrapElementWithAPI(element, this);
  }

  async findVisibleElement(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const element = await this.findElement(locator);
    await this.driver.wait(until.elementIsVisible(element), this.timeout);
    return wrapElementWithAPI(element, this);
  }

  async findClickableElement(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const element = await this.findElement(locator);
    await Promise.all([
      this.driver.wait(until.elementIsVisible(element), this.timeout),
      this.driver.wait(until.elementIsEnabled(element), this.timeout),
    ]);
    return wrapElementWithAPI(element, this);
  }

  async findElements(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const elements = await this.driver.wait(
      until.elementsLocated(locator),
      this.timeout,
    );
    return elements.map((element) => wrapElementWithAPI(element, this));
  }

  async findAllElementsWithId(id){
    let elements = await this.driver.findElements(By.id(id));
    return elements.map((element) => wrapElementWithAPI(element, this));
  }

  async findClickableElements(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const elements = await this.findElements(locator);
    await Promise.all(
      elements.reduce((acc, element) => {
        acc.push(
          this.driver.wait(until.elementIsVisible(element), this.timeout),
          this.driver.wait(until.elementIsEnabled(element), this.timeout),
        );
        return acc;
      }, []),
    );
    return elements.map((element) => wrapElementWithAPI(element, this));
  }

  async clickElement(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    const element = await this.findClickableElement(locator);
    await element.click();
  }

  async clickPoint(rawLocator, x, y) {
    const locator = this.buildLocator(rawLocator);
    const element = await this.findElement(locator);
    await this.driver
      .actions()
      .move({ origin: element, x, y })
      .click()
      .perform();
  }

  async scrollToElement(element) {
    await this.driver.executeScript(
      'arguments[0].scrollIntoView(true)',
      element,
    );
  }

  async assertElementNotPresent(rawLocator) {
    const locator = this.buildLocator(rawLocator);
    let dataTab;
    try {
      dataTab = await this.findElement(locator);
    } catch (err) {
      assert(
        err instanceof webdriverError.NoSuchElementError ||
          err instanceof webdriverError.TimeoutError,
      );
    }
    assert.ok(!dataTab, 'Found element that should not be present');
  }


  async navigate(page = Driver.PAGES.HOME) {
    return await this.driver.get(`${this.extensionUrl}/${page}.html`);
  }

  async openNewPage(url) {
    const newHandle = await this.driver.switchTo().newWindow();
    await this.driver.get(url);
    return newHandle;
  }

  async switchToWindow(handle) {
    await this.driver.switchTo().window(handle);
  }

  async getAllWindowHandles() {
    return await this.driver.getAllWindowHandles();
  }

  async waitUntilXWindowHandles(x, delayStep = 1000, timeout = 5000) {
    let timeElapsed = 0;
    let windowHandles = [];
    while (timeElapsed <= timeout) {
      windowHandles = await this.driver.getAllWindowHandles();
      if (windowHandles.length === x) {
        return windowHandles;
      }
      await this.delay(delayStep);
      timeElapsed += delayStep;
    }
    throw new Error('waitUntilXWindowHandles timed out polling window handles');
  }

  async switchToWindowWithTitle(
    title,
    initialWindowHandles,
    delayStep = 1000,
    timeout = 5000,
  ) {
    let windowHandles =
      initialWindowHandles || (await this.driver.getAllWindowHandles());
    let timeElapsed = 0;
    while (timeElapsed <= timeout) {
      for (const handle of windowHandles) {
        await this.driver.switchTo().window(handle);
        const handleTitle = await this.driver.getTitle();
        if (handleTitle === title) {
          return handle;
        }
      }
      await this.delay(delayStep);
      timeElapsed += delayStep;
      windowHandles = await this.driver.getAllWindowHandles();
    }

    throw new Error(`No window with title: ${title}`);
  }

  async closeAllWindowHandlesExcept(exceptions, windowHandles) {

    windowHandles = windowHandles || (await this.driver.getAllWindowHandles());

    for (const handle of windowHandles) {
      if (!exceptions.includes(handle)) {
        await this.driver.switchTo().window(handle);
        await this.delay(1000);
        await this.driver.close();
        await this.delay(1000);
      }
    }
  }

  async verboseReportOnFailure(title) {
    const artifactDir = `./test-artifacts/${this.browser}/${title}`;
    const filepathBase = `${artifactDir}/test-failure`;
    await fs.mkdir(artifactDir, { recursive: true });
    const screenshot = await this.driver.takeScreenshot();
    await fs.writeFile(`${filepathBase}-screenshot.png`, screenshot, {
      encoding: 'base64',
    });
    const htmlSource = await this.driver.getPageSource();
    await fs.writeFile(`${filepathBase}-dom.html`, htmlSource);
    const uiState = await this.driver.executeScript(
      () => window.getCleanAppState && window.getCleanAppState(),
    );
    await fs.writeFile(
      `${filepathBase}-state.json`,
      JSON.stringify(uiState, null, 2),
    );
  }

  async checkBrowserForConsoleErrors() {
    const ignoredLogTypes = ['WARNING'];
    const ignoredErrorMessages = [
      'favicon.ico - Failed to load resource: the server responded with a status of 404 (Not Found)',
    ];
    const browserLogs = await this.driver.manage().logs().get('browser');
    const errorEntries = browserLogs.filter(
      (entry) => !ignoredLogTypes.includes(entry.level.toString()),
    );
    const errorObjects = errorEntries.map((entry) => entry.toJSON());
    return errorObjects.filter(
      (entry) =>
        !ignoredErrorMessages.some((message) =>
          entry.message.includes(message),
        ),
    );
  }
}

Driver.PAGES = {
  HOME: 'app',
  NOTIFICATION: 'notification',
  POPUP: 'popup',
};

module.exports = Driver;
