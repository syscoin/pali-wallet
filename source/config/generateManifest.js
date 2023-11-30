/* eslint-disable import/no-extraneous-dependencies */
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

function generateManifest() {
  console.log(process.env.MANIFEST_TYPE);
  const manifestOptions = {
    appName: process.env.APP_NAME || 'DefaultAppNameee',
  };

  if (process.env.FEATURE_A === 'true') {
    manifestOptions.featureA = true;
  }

  if (process.env.FEATURE_B === 'true') {
    manifestOptions.featureB = true;
  }

  const manifestContent = JSON.stringify(manifestOptions, null, 2);
  fs.writeFileSync('manifestTest.json', manifestContent);
}

generateManifest();
