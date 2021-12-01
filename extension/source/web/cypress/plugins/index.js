/// <reference types="cypress" />
// ***********************************************************
// This example plugins/index.js can be used to load plugins
//
// You can change the location of this file or turn off loading
// the plugins file with the 'pluginsFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/plugins-guide
// ***********************************************************

// This function is called when a project is opened or re-opened (e.g. due to
// the project's config changing)

/**
 * @type {Cypress.PluginConfig}
 */
// eslint-disable-next-line no-unused-vars

const path = require('path');
// const extension = require('../../../../extension/chrome');
const execa = require('execa');

const findBrowser = () => {
  // the path is hard-coded for simplicity
  const browserPath = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

  return execa(browserPath, ['--version']).then((result) => {
    // STDOUT will be like "Brave Browser 77.0.69.135"
    const [, version] = /Brave Browser (\d+\.\d+\.\d+\.\d+)/.exec(result.stdout)
    const majorVersion = parseInt(version.split('.')[0])

    return {
      name: 'Brave',
      channel: 'stable',
      family: 'chromium',
      displayName: 'Brave',
      version,
      path: browserPath,
      majorVersion,
    }
  })
}

module.exports = (on, config) => {
  on('before:browser:launch', (browser, launchOptions) => {
    console.log('launching browser %o', browser)

    // only load React DevTools extension
    // when opening Chrome in interactive mode
    if (browser.family === 'chromium') {
      // we could also restrict the extension
      // to only load when "browser.isHeaded" is true
      const extensionFolder = path.resolve(__dirname, '../../../../extension/chrome');

      console.log('adding pali wallet extension from', extensionFolder)
      launchOptions.args.push(`--load-extension=${extensionFolder}`)
      launchOptions.extensions.push(extensionFolder);

      return launchOptions;
    }
  });

  return findBrowser().then((browser) => {
    return {
      browsers: !config.browsers.includes(browser) && config.browsers.concat(browser),
    }
  })
}