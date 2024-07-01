const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { DefinePlugin } = require('webpack');
const paths = require('./paths');
const { join } = require('path');

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

const plugins = [
  new ForkTsCheckerWebpackPlugin(),
  new DefinePlugin({
    NODE_ENV: JSON.stringify(process.env.NODE_ENV),
    TARGET_BROWSER: JSON.stringify(targetBrowser),
  }),
  new HtmlWebpackPlugin({
    template: join(paths.viewsPath, 'app.html'),
    inject: 'body',
    chunks: ['app'],
    hash: true,
    filename: 'app.html',
  }),
  new HtmlWebpackPlugin({
    template: join(paths.viewsPath, 'external.html'),
    inject: 'body',
    chunks: ['external'],
    hash: true,
    filename: 'external.html',
  }),
  new HtmlWebpackPlugin({
    template: join(paths.viewsPath, 'trezor-usb-permissions.html'),
    filename: 'trezor-usb-permissions.html',
    inject: 'body',
    chunks: ['trezorUSB'],
  }),
  new HtmlWebpackPlugin({
    template: join(paths.viewsPath, 'offscreen.html'),
    filename: 'offscreen.html',
    inject: 'body',
    chunks: ['offscreenScript'],
  }),
  new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
  new CopyWebpackPlugin({
    patterns: [
      { from: 'source/assets', to: 'assets' },
      {
        from: 'manifest.json',
        to: join(__dirname, '../../../build', targetBrowser, 'manifest.json'),
      },
    ],
  }),
  new NodePolyfillPlugin(),
];

module.exports = plugins;
