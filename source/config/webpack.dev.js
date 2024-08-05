/* eslint-disable @typescript-eslint/no-var-requires */

const { merge } = require('webpack-merge');

const common = require('./webpack.common');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    compress: true,
    port: 9090,
    hot: true,
    watchFiles: ['*'],
  },
});
