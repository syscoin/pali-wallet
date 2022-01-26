import assert from 'assert';

import { beforeEach, afterEach } from 'mocha';
import { buildWebDriver } from '../webdriver';
import { importWallet } from '../initialize';
import { By } from 'selenium-webdriver';

describe('Account settings UI tests', async () => {
  let uiWebDriver = null;

  beforeEach(async () => {
    const { driver } = await buildWebDriver();

    uiWebDriver = driver;

    await driver.navigate();
    await importWallet({ driver });
    await uiWebDriver.clickElement('#account-settings-btn');
  });

  afterEach(() => {
    uiWebDriver.quit();
  });

  it("should check if your keys button it's being shown and working correctly", async () => {
    const yourKeysButton = await uiWebDriver.findElement(
      By.id('your-keys-btn')
    );

    assert.ok(
      typeof yourKeysButton === 'object',
      '<!> Cannot find your keys button <!>'
    );

    await uiWebDriver.clickElement('#your-keys-btn');
    const findYourKeysTitle = await uiWebDriver.findElement(
      By.id('your-keys-title')
    );
    const yourKeysText = await findYourKeysTitle.getText();
    assert.equal(
      yourKeysText,
      'YOUR KEYS',

      '<!> your keys button is working different than the the expected <!>'
    );
  });

  it("should check if accounts button it's being shown and working correctly", async () => {
    const accountsButton = await uiWebDriver.findElement(By.id('accounts-btn'));

    assert.ok(
      typeof accountsButton === 'object',
      '<!> Cannot find accounts button <!>'
    );

    await uiWebDriver.clickElement('#accounts-btn');
    const createAccountButton = await uiWebDriver.findElement(
      By.id('create-account-btn')
    );

    assert.ok(
      typeof createAccountButton === 'object',
      '<!> Account button is working different than the the expected <!>'
    );
  });

  it("should check if create account button it's being shown and working correctly", async () => {
    await uiWebDriver.clickElement('#accounts-btn');
    const createAccountButton = await uiWebDriver.findElement(
      By.id('create-account-btn')
    );

    assert.ok(
      typeof createAccountButton === 'object',
      '<!> Cannot find create account button <!>'
    );

    await uiWebDriver.clickElement('#create-account-btn');
    const createAccountTitle = await uiWebDriver.findElement(
      By.id('create-account-title')
    );

    assert.equal(
      createAccountTitle,
      'CREATE ACCOUNT',
      '<!> Create account button is working different than the the expected <!>'
    );
  });

  it("should check if hardware wallet button it's being shown and working correctly", async () => {
    const yourKeysButton = await uiWebDriver.findElement(
      By.id('hardware-wallet-btn')
    );

    assert.ok(
      typeof yourKeysButton === 'object',
      '<!> Cannot find hardware wallet button <!>'
    );

    await uiWebDriver.clickElement('#hardware-wallet-btn');
    const findHardwareWalletTitle = await uiWebDriver.findElement(
      By.id('hardware-wallet-title')
    );
    const hardwareWalletText = await findHardwareWalletTitle.getText();
    assert.equal(
      hardwareWalletText,
      'HARDWARE WALLET',

      '<!> hardware wallet button is working different than the the expected <!>'
    );
  });

  it("should check if lock button it's being shown and working correctly", async () => {
    const lockButton = await uiWebDriver.findElement(By.id('lock-btn'));

    assert.ok(
      typeof lockButton === 'object',
      '<!> Cannot find lock button <!>'
    );

    await uiWebDriver.clickElement('#lock-btn');
    const findWelcomeTitle = await uiWebDriver.findElement(
      By.id('welcome-auth-title')
    );
    const welcomeText = await findWelcomeTitle.getText();
    assert.equal(
      welcomeText,
      'WELCOME TO',

      '<!> lock button is working different than the the expected <!>'
    );
  });
});

// describe('Account settings UX test', () => {

/* it("should create new account after login", async () => {
    await uiWebDriver.clickElement("#account-settings-btn");
    await uiWebDriver.clickElement(".accounts-btn");
    await uiWebDriver.clickElement(".create-account-btn");
    await uiWebDriver.fill(".new-account-name-input", "Test Account");
    await uiWebDriver.clickElement("#create-btn");
    await uiWebDriver.clickElement("#got-it-btn");
    await uiWebDriver.clickElement("#account-settings-btn");
    await uiWebDriver.clickElement(".accounts-btn");
    const findNewAccount = await uiWebDriver.findElement(
      By.xpath("*[text()='Test Account']")
    );
    if (findNewAccount) {
      console.log("New Account has been created");
    } else {
      console.log("New Account has not been created");
    }
  }); */
//   it('should create new account after login', async () => {
//     let driver;
//     const { driver: webDriver } = await buildWebDriver();
//     driver = webDriver;
//     await initializator();
//     await driver.clickElement('#account-settings-btn');
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('.create-account-btn');
//     await driver.fill('.new-account-name-input', 'Test Account');
//     await driver.clickElement('#create-btn');
//     await driver.clickElement('#got-it-btn');
//     await driver.clickElement('#account-settings-btn');
//     await driver.clickElement('.accounts-btn');
//     const findNewAccount = await driver.findElement(
//       By.xpath("//*[text()='Test Account']")
//     );
//     if (findNewAccount) {
//       console.log('New Account has been created');
//     } else {
//       console.log('New Account has not been created');
//     }
//     driver.quit();
//   });

//   it('should switch account after create new account', async () => {
//     let driver;
//     const { driver: webDriver } = await buildWebDriver();
//     driver = webDriver;
//     await initializator();
//     const findDefaultActiveAccount = setTimeout(async () => {
//       await driver.findElement(By.xpath("//*[text()='Account 1']"));
//     }, 2000);
//     if (findDefaultActiveAccount) {
//       console.log('Account 1 is the active account set by default');
//     } else {
//       console.log('Account 1 is NOT the active account set by default');
//     }
//     setTimeout(async () => {
//       await driver.clickElement('#account-settings-btn');
//     }, 2000);
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('.create-account-btn');
//     await driver.fill('.new-account-name-input', 'Test Account');
//     await driver.clickElement('#create-btn');
//     await driver.clickElement('#got-it-btn');
//     await driver.clickElement('#account-settings-btn');
//     await driver.clickElement('.accounts-btn');
//     await driver.clickElement('#account-1');
//     const findNewActiveAccount = await driver.findElement(
//       By.xpath("//*[text()='Test Account']")
//     );
//     if (findNewActiveAccount) {
//       console.log('Switch Account is working correctly');
//     } else {
//       console.log('Switch Account is NOT working correctly');
//     }
//     driver.quit();
//   });

// });
