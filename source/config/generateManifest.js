/* eslint-disable */

const dotenv = require('dotenv');
const fs = require('fs');
const { extensionBuildVersion } = require('./extensionBuildVersion.cjs');

const packageJson = require('../../package.json');
const {
  CANARY_EXTENSION_KEY,
  MV2_OPTIONS,
  MV3_OPTIONS,
} = require('./consts.js');

dotenv.config();

function generateManifest() {
  const manifestOptions = JSON.parse(JSON.stringify(
    process.env.MANIFEST_TYPE === 'MV2' ? MV2_OPTIONS : MV3_OPTIONS
  ));
  Object.assign(manifestOptions, extensionBuildVersion(
    process.env.NODE_ENV, packageJson.version, process.env.PALI_CANARY_BUILD_NUMBER
  ));

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
    // Store uploads reject `key`; it only stabilizes unpacked Canary identity.
    if (manifestOptions.manifest_version === 3 && process.env.PALI_EXTENSION_STORE_BUILD !== '1') {
      manifestOptions.key = CANARY_EXTENSION_KEY;
    }
    if (manifestOptions.permissions) {
      manifestOptions.permissions = filterWebRequest(
        manifestOptions.permissions
      );
    }
  }

  const manifestContent = JSON.stringify(manifestOptions, null, 2);
  fs.writeFileSync(process.env.PALI_EXTENSION_MANIFEST || 'manifest.json', manifestContent);
}

const filterWebRequest = (permissions) => {
  return permissions.filter((permission) => permission !== 'webRequest');
};

generateManifest();
