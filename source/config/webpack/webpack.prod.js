const { merge } = require('webpack-merge');
const path = require('path');
const ZipPlugin = require('zip-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const common = require('./webpack.common');
const version = require('../../../package.json').version;

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  plugins: [
    new ZipPlugin({
      filename: `pali-wallet-${targetBrowser}-${version}`,
      path: path.resolve(__dirname, '../../../build'),
      pathPrefix: `${targetBrowser}`,
      include: [/\.js$/, /\.css$/, /\.html$/, /manifest\.json$/],
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
        '../../../build',
        `${targetBrowser}-report.html`
      ),
    }),
  ],
});
