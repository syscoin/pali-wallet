import { assert } from 'assert';

export const checkVisibility = async (className) => {
  const element = await driver.findElement(By.className(`.${className}`));

  // assert(element.size() > 0, true);

  if (element) {
    console.log(`${buttonName}` + ' button is working correctly');
  } else {
    console.log(`${buttonName}` + ' button is NOT working correctly');
  }
};

export const checkIfElementIsWorking = async (className) => {
  await driver.clickElement(`.${className}`);

  const element = await driver.findElement(By.xpath(`//*[text()=${result}]`));

  if (element) {
    console.log(`${buttonName}` + ' button is working correctly');
  } else {
    console.log(`${buttonName}` + ' button is NOT working correctly');
  }
};
