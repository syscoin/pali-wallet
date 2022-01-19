const initializator = require('../initializator');
const { browser } = require('webextension-polyfill-ts');
const { By } = require('selenium-webdriver');

describe('Send Screen Tests', () => {
  it("should check if send form it's being shown", async () => {
    await initializator();
    await driver.clickElement('.send-btn');
    const findSendBalance = await driver.findElement(
      By.className('.send-balance')
    );
    if (findSendBalance) {
      console.log('send balance is being shown');
    } else {
      console.log('send balance is NOT being shown');
    }

    const findReceiverInput = await driver.findElement(
      By.className('.receiver-input')
    );
    if (findReceiverInput) {
      console.log('receiver input is being shown');
    } else {
      console.log('receiver input is NOT being shown');
    }

    const findNetworkDropdown = await driver.findElement(
      By.className('.send-network-dropdown')
    );
    if (findNetworkDropdown) {
      console.log('network dropdown is being shown');
    } else {
      console.log('network dropdown is NOT being shown');
    }

    const findVerifyAddress = await driver.findElement(
      By.className('.verify-address-switch')
    );
    if (findVerifyAddress) {
      console.log('verify address switch is being shown');
    } else {
      console.log('verify address switch is NOT being shown');
    }

    const findZDagSwitch = await driver.findElement(
      By.className('.z-dag-switch')
    );
    if (findZDagSwitch) {
      console.log('verify z-dag switch is being shown');
    } else {
      console.log('verify z-dag switch is NOT being shown');
    }

    const findAmountInput = await driver.findElement(
      By.className('.amount-input')
    );
    if (findAmountInput) {
      console.log('Amount input is being shown');
    } else {
      console.log('Amount input is NOT being shown');
    }

    const findNextBtn = await driver.findElement(By.id('#next-btn'));
    if (findNextBtn) {
      console.log('Next button is being shown');
    } else {
      console.log('Next button is NOT being shown');
    }
    driver.quit();
  });

  it("should check if fee input it's being shown", async () => {
    const findFeeInput = await driver.findElement(By.className('.fee-input'));
    if (findFeeInput) {
      console.log('Fee input is being shown');
    } else {
      console.log('Fee input is NOT being shown');
    }
    //It's not ready yet, still need to check if it's disabled if it's using a Syscoin Network
    driver.quit();
  });
});
