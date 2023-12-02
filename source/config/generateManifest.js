/* eslint-disable */

const dotenv = require('dotenv');
const fs = require('fs');

const { MV2_OPTIONS, MV3_OPTIONS } = require('./consts.js');

dotenv.config();

function generateManifest() {
  console.log(process.env.MANIFEST_TYPE);
  const manifestOptions =
    process.env.MANIFEST_TYPE === 'MV2' ? MV2_OPTIONS : MV3_OPTIONS;

  const manifestContent = JSON.stringify(manifestOptions, null, 2);
  fs.writeFileSync('manifest.json', manifestContent);
}

generateManifest();
