function checkShown(className, variableName, buttonName) {
  const variableName = await driver.findElement(
    By.className('.'`${className}`)
  );
  if (variableName) {
    console.log(`${buttonName}` + ' button is being shown');
  } else {
    console.log(`${buttonName}` + ' button is NOT being shown');
  }
}

function checkWorking(className, variableName, buttonName, result) {
  await driver.clickElement('.'`${className}`);
  const variableName = await driver.findElement(
    By.xpath("//*[text()='" + `${result}` + "']")
  );
  if (variableName) {
    console.log(`${buttonName}` + ' button is working correctly');
  } else {
    console.log(`${buttonName}` + ' button is NOT working correctly');
  }
}

module.exports = { checkShown, checkWorking };
