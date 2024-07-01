const { join } = require('path');
const paths = require('./paths');
const rules = require('./rules');
const plugins = require('./plugins');
const optimization = require('./optimization');
const entry = require('./entry');
const alias = require('./alias');

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

module.exports = {
  entry,
  output: {
    path: join(paths.destPath, targetBrowser),
    filename: 'js/[name].bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias,
    fallback: {
      fs: false,
    },
  },
  module: {
    rules,
  },
  plugins,
  optimization,
};
