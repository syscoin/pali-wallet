const { buildWebDriver } = require('./webdriver');

const delay200 = 200;
const delay400 = delay200 * 2;
const delay800 = delay400 * 2;

async function withFixtures(options, testSuite) {
  const {
    dapp,
    fixtures,
    ganacheOptions,
    driverOptions,
    mockSegment,
    title,
    failOnConsoleError = true,
    dappPath = undefined,
    leaveRunning = false,
  } = options;

  let webDriver;
  let failed = false;
  try {
    const { driver } = await buildWebDriver(driverOptions);
    webDriver = driver;

    await testSuite({
      driver,
    });

    if (process.env.SELENIUM_BROWSER === 'chrome') {
      const errors = await driver.checkBrowserForConsoleErrors(driver);
      if (errors.length) {
        const errorReports = errors.map((err) => err.message);
        const errorMessage = `Errors found in browser console:\n${errorReports.join(
          '\n',
        )}`;
        if (failOnConsoleError) {
          throw new Error(errorMessage);
        } else {
          console.error(new Error(errorMessage));
        }
      }
    }
  } catch (error) {
    failed = true;
    if (webDriver) {
      try {
        await webDriver.verboseReportOnFailure(title);
      } catch (verboseReportError) {
        console.error(verboseReportError);
      }
    }
    throw error;
  } finally {
    if (!failed && !leaveRunning) {
      if (webDriver) {
        await webDriver.quit();
      }
    }
  }
}

module.exports = {
  delay200,
  delay400,
  delay800,
  withFixtures,
};
