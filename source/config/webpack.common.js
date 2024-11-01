/* eslint-disable @typescript-eslint/no-var-requires */

const CopyWebpackPlugin = require('copy-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { join, resolve } = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const { DefinePlugin } = require('webpack');

const viewsPath = join(__dirname, '../../views');
const sourcePath = join(__dirname, '../../source');
const destPath = join(__dirname, '../../build');
const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

module.exports = {
  entry: {
    manifest: join(__dirname, '../../manifest.json'),
    background: join(sourcePath, 'scripts/Background', 'index.ts'),
    inpage: join(sourcePath, 'scripts/ContentScript', 'inject/inpage.ts'),
    pali: join(sourcePath, 'scripts/ContentScript', 'inject/pali.ts'),
    handleWindowProperties: join(
      sourcePath,
      'scripts/ContentScript',
      'inject/handleWindowProperties.ts'
    ),
    contentScript: join(sourcePath, 'scripts/ContentScript', 'index.ts'),
    app: join(sourcePath, 'pages/App', 'index.tsx'),
    external: join(sourcePath, 'pages/External', 'index.tsx'),
    trezorScript: join(
      sourcePath,
      'scripts/ContentScript/trezor',
      'trezor-content-script.ts'
    ),
    trezorUSB: join(
      sourcePath,
      'scripts/ContentScript/trezor',
      'trezor-usb-permissions.ts'
    ),
    offscreenScript: join(
      sourcePath,
      'scripts/ContentScript/offscreen',
      'index.ts'
    ),
  },
  output: {
    path: join(destPath, targetBrowser),
    filename: 'js/[name].bundle.js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      assets: resolve(__dirname, '../../source/assets'),
      components: resolve(__dirname, '../../source/components'),
      scripts: resolve(__dirname, '../../source/scripts'),
      containers: resolve(__dirname, '../../source/containers'),
      pages: resolve(__dirname, '../../source/pages'),
      routers: resolve(__dirname, '../../source/routers'),
      state: resolve(__dirname, '../../source/state'),
      constants: resolve(__dirname, '../../source/constants'),
      services: resolve(__dirname, '../../source/services'),
      hooks: resolve(__dirname, '../../source/hooks'),
      utils: resolve(__dirname, '../../source/utils'),
      helpers: resolve(__dirname, '../../source/helpers'),
    },
    fallback: {
      fs: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.(jpg|png|xlsx|xls|csv)$/i,
        type: 'asset/resource',
        generator: {
          filename: '[path][name][ext]',
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(svg)$/i,
        type: 'asset/inline',
        exclude: /node_modules/,
      },
      {
        test: /\.(js|ts)x?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.less$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'less-loader',
            options: {
              lessOptions: {
                modifyVars: {
                  'primary-color': '#1DA57A',
                  'link-color': '#1DA57A',
                  'border-radius-base': '2rem',
                },
                javascriptEnabled: true,
              },
            },
          },
        ],
      },
      {
        test: /\.(ttf)$/,
        type: 'asset/resource',
        generator: {
          filename: '[path][name][ext]',
        },
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader',
          'resolve-url-loader',
          'sass-loader',
        ],
      },
    ],
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin(),
    new DefinePlugin({
      NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      TARGET_BROWSER: JSON.stringify(targetBrowser),
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'app.html'),
      inject: 'body',
      chunks: ['app'],
      hash: true,
      filename: 'app.html',
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'external.html'),
      inject: 'body',
      chunks: ['external'],
      hash: true,
      filename: 'external.html',
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'trezor-usb-permissions.html'),
      filename: 'trezor-usb-permissions.html',
      inject: 'body',
      chunks: ['trezorUSB'],
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'offscreen.html'),
      filename: 'offscreen.html',
      inject: 'body',
      chunks: ['offscreenScript'],
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'side_panel.html'),
      filename: 'side_panel.html',
      inject: 'body',
      chunks: ['app'],
    }),
    new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'source/assets', to: 'assets' }],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: './manifest.json',
          to: join(__dirname, '../../build/chrome'),
          force: true,
          transform: function (content) {
            return Buffer.from(
              JSON.stringify({ ...JSON.parse(content.toString()) })
            );
          },
        },
      ],
    }),
    new NodePolyfillPlugin(),
  ],
  optimization: {
    minimizer: [
      new CssMinimizerPlugin(),
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: {
            drop_console: true,
          },
          output: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
};
