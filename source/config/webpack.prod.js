/* eslint-disable @typescript-eslint/no-var-requires */

const path = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const { merge } = require('webpack-merge');
const ZipPlugin = require('zip-webpack-plugin');

const common = require('./webpack.common');

const version = require('../../package.json').version;

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  plugins: [
    new ZipPlugin({
      filename: `pali-wallet-${targetBrowser}-${version}`,
      path: path.join(__dirname, '../../build'),
      extension: `${
        targetBrowser === 'opera'
          ? 'crx'
          : targetBrowser === 'firefox'
          ? 'xpi'
          : 'zip'
      }`,
    }),
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      openAnalyzer: false,
      reportFilename: path.join(
        __dirname,
        '../../build',
        `${targetBrowser}-report.html`
      ),
    }),
  ],
});
