/* eslint-disable */

const dotenv = require('dotenv');
const fs = require('fs');

const { MV2_OPTIONS, MV3_OPTIONS } = require('./consts.js');

dotenv.config();

function generateManifest() {
  const manifestOptions =
    process.env.MANIFEST_TYPE === 'MV2' ? MV2_OPTIONS : MV3_OPTIONS;

  // dev
  if (process.env.NODE_ENV === 'development') {
    delete manifestOptions.environment;
    if (!manifestOptions.permissions) {
      manifestOptions.permissions = [];
    }
    if (!manifestOptions.permissions.includes('webRequest')) {
      manifestOptions.permissions.push('webRequest');
    }
  }

  // prod
  if (process.env.NODE_ENV === 'production') {
    if (manifestOptions.permissions) {
      manifestOptions.permissions = filterWebRequest(
        manifestOptions.permissions
      );
    }
  }

  // canary
  if (process.env.NODE_ENV === 'canary') {
    manifestOptions.name = manifestOptions.name.replace(
      'Pali Wallet',
      'Pali Wallet Canary'
    );
    if (manifestOptions.permissions) {
      manifestOptions.permissions = filterWebRequest(
        manifestOptions.permissions
      );
    }
  }

  const manifestContent = JSON.stringify(manifestOptions, null, 2);
  fs.writeFileSync('manifest.json', manifestContent);
}

const filterWebRequest = (permissions) => {
  return permissions.filter((permission) => permission !== 'webRequest');
};

generateManifest();
