/* eslint-disable camelcase */
const MV2_OPTIONS = {
  manifest_version: 2,
  name: 'Pali Wallet',
  version: '2.0.16',
  icons: {
    16: 'assets/all_assets/favicon-16.png',
    32: 'assets/all_assets/favicon-32.png',
    48: 'assets/all_assets/favicon-48.png',
    128: 'assets/all_assets/favicon-128.png',
  },
  description: 'A Non-Custodial Crypto Wallet',
  short_name: 'pali',
  permissions: [
    'http://*/*',
    'https://*/*',
    '*://connect.trezor.io/9/*',
    'tabs',
    'storage',
    'activeTab',
    'clipboardWrite',
    'unlimitedStorage',
    'http://localhost:8545/',
  ],
  content_security_policy: "script-src 'self'; object-src 'self'",
  author: 'Syscoin',
  minimum_chrome_version: '49',
  browser_action: {
    default_popup: 'app.html',
    default_icon: {
      16: 'assets/all_assets/favicon-16.png',
      32: 'assets/all_assets/favicon-32.png',
      48: 'assets/all_assets/favicon-48.png',
      128: 'assets/all_assets/favicon-128.png',
    },
    default_title: 'Pali Wallet',
    chrome_style: false,
  },
  background: {
    scripts: ['js/background.bundle.js'],
    persistent: true,
  },
  content_scripts: [
    {
      all_frames: true,
      matches: ['file://*/*', 'http://*/*', 'https://*/*'],
      run_at: 'document_start',
      js: ['js/contentScript.bundle.js'],
    },
    {
      matches: [
        '*://connect.trezor.io/9/popup.html',
        'https://localhost:8088/*',
      ],
      js: ['js/trezorScript.bundle.js'],
    },
  ],
  web_accessible_resources: [
    'js/inpage.bundle.js',
    'js/handleWindowProperties.bundle.js',
    'js/pali.bundle.js',
    'assets/all_assets/favicon-16.png',
    'assets/all_assets/favicon-32.png',
    'assets/all_assets/favicon-48.png',
    'assets/all_assets/favicon-128.png',
  ],
  commands: {
    _execute_browser_action: {
      suggested_key: {
        default: 'Ctrl+Shift+P',
      },
    },
  },
};

const MV3_OPTIONS = {
  manifest_version: 3,
  name: 'Pali Wallet',
  version: '4.0.10',
  icons: {
    16: 'assets/all_assets/favicon-16.png',
    32: 'assets/all_assets/favicon-32.png',
    48: 'assets/all_assets/favicon-48.png',
    128: 'assets/all_assets/favicon-128.png',
  },
  description: 'A Non-Custodial Crypto Wallet',
  short_name: 'pali',
  permissions: [
    'hid',
    'alarms',
    'storage',
    'activeTab',
    'clipboardWrite',
    'unlimitedStorage',
    'offscreen',
    'scripting',
    'notifications',
  ],
  host_permissions: [
    'http://*/*',
    'https://*/*',
    '*://connect.trezor.io/9/*',
    'http://localhost:8545/',
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:;",
  },
  author: 'Syscoin',
  minimum_chrome_version: '109',
  action: {
    default_popup: 'app.html',
    default_icon: {
      16: 'assets/all_assets/favicon-16.png',
      32: 'assets/all_assets/favicon-32.png',
      48: 'assets/all_assets/favicon-48.png',
      128: 'assets/all_assets/favicon-128.png',
    },
    default_title: 'Pali Wallet',
  },
  background: {
    service_worker: 'js/background.bundle.js',
  },
  content_scripts: [
    {
      all_frames: true,
      matches: ['file://*/*', 'http://*/*', 'https://*/*'],
      run_at: 'document_start',
      js: ['js/contentScript.bundle.js'],
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        'js/inpage.bundle.js',
        'js/handleWindowProperties.bundle.js',
        'js/pali.bundle.js',
        'assets/all_assets/*',
        'assets/all_assets/favicon-16.png',
        'assets/all_assets/favicon-32.png',
        'assets/all_assets/favicon-48.png',
        'assets/all_assets/favicon-128.png',
      ],
      matches: ['<all_urls>'],
    },
  ],
  commands: {
    _execute_action: {
      suggested_key: {
        default: 'Ctrl+Shift+P',
      },
    },
  },
};

module.exports = {
  MV2_OPTIONS,
  MV3_OPTIONS,
};
