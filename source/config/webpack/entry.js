const { join } = require('path');
const paths = require('./paths');

const entry = {
  manifest: join(__dirname, '../../../manifest.json'),
  background: join(paths.sourcePath, 'scripts/Background', 'index.ts'),
  inpage: join(paths.sourcePath, 'scripts/ContentScript', 'inject/inpage.ts'),
  pali: join(paths.sourcePath, 'scripts/ContentScript', 'inject/pali.ts'),
  handleWindowProperties: join(
    paths.sourcePath,
    'scripts/ContentScript',
    'inject/handleWindowProperties.ts'
  ),
  contentScript: join(paths.sourcePath, 'scripts/ContentScript', 'index.ts'),
  app: join(paths.sourcePath, 'pages/App', 'index.tsx'),
  external: join(paths.sourcePath, 'pages/External', 'index.tsx'),
  trezorScript: join(
    paths.sourcePath,
    'scripts/ContentScript/trezor',
    'trezor-content-script.ts'
  ),
  trezorUSB: join(
    paths.sourcePath,
    'scripts/ContentScript/trezor',
    'trezor-usb-permissions.ts'
  ),
  offscreenScript: join(
    paths.sourcePath,
    'scripts/ContentScript/offscreen',
    'index.ts'
  ),
};

module.exports = entry;
