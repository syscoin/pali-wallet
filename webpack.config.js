const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');
const WextManifestWebpackPlugin = require('wext-manifest-webpack-plugin');
const ZipPlugin = require('zip-webpack-plugin');
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin")

const viewsPath = path.join(__dirname, 'views');
const sourcePath = path.join(__dirname, 'source');
const destPath = path.join(__dirname, 'build');
const nodeEnv = process.env.NODE_ENV || 'development';
const targetBrowser = process.env.TARGET_BROWSER;

const getExtensionFileType = (browser) => {
  if (browser === 'opera') {
    return 'crx';
  }

  if (browser === 'firefox') {
    return 'xpi';
  }

  return 'zip';
};

module.exports = {
  devtool: false, //https://webpack.js.org/configuration/devtool/#root

  stats: {
    all: false,
    builtAt: true,
    errors: true,
    hash: true,
  },

  mode: nodeEnv,

  entry: {
    manifest: path.join(__dirname, 'manifest.json'),
    webextension: path.join(
      __dirname,
      'node_modules',
      'webextension-polyfill-ts',
      'lib/index.js'
    ),
    background: path.join(sourcePath, 'scripts/Background', 'index.ts'),
    inpage: path.join(sourcePath, 'scripts/ContentScript', 'inject/inpage.ts'),
    pali: path.join(sourcePath, 'scripts/ContentScript', 'inject/pali.ts'),
    handleWindowProperties: path.join(
      sourcePath,
      'scripts/ContentScript',
      'inject/handleWindowProperties.ts'
    ),
    contentScript: path.join(sourcePath, 'scripts/ContentScript', 'index.ts'),
    app: path.join(sourcePath, 'pages/App', 'index.tsx'),
    external: path.join(sourcePath, 'pages/External', 'index.tsx'),
    trezorScript: path.join(
      sourcePath,
      'scripts/ContentScript/trezor',
      'trezor-content-script.ts'
    ),
    trezorUSB: path.join(
      sourcePath,
      'scripts/ContentScript/trezor',
      'trezor-usb-permissions.ts'
    ),
  },
  output: {
    path: path.join(destPath, targetBrowser),
    filename: 'js/[name].bundle.js',
    // delete previous build files -> Use instead clean-webpack-plugin
    clean: true,
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      'webextension-polyfill-ts': path.resolve(
        path.join(__dirname, 'node_modules', 'webextension-polyfill-ts')
      ),
      assets: path.resolve(__dirname, 'source/assets'),
      components: path.resolve(__dirname, 'source/components'),
      scripts: path.resolve(__dirname, 'source/scripts'),
      containers: path.resolve(__dirname, 'source/containers'),
      pages: path.resolve(__dirname, 'source/pages'),
      routers: path.resolve(__dirname, 'source/routers'),
      state: path.resolve(__dirname, 'source/state'),
      constants: path.resolve(__dirname, 'source/constants'),
      services: path.resolve(__dirname, 'source/services'),
      hooks: path.resolve(__dirname, 'source/hooks'),
      tests: path.resolve(__dirname, 'source/tests'),
      utils: path.resolve(__dirname, 'source/utils'),
      helpers: path.resolve(__dirname, 'source/helpers'),
    },
    fallback: {
      fs: false
    },
  },

  module: {
    rules: [
      {
        type: 'javascript/auto', // prevent webpack handling json with its own loaders,
        test: /manifest\.json$/,
        use: {
          loader: 'wext-manifest-loader',
          options: {
            usePackageJSONVersion: true, // set to false to not use package.json version for manifest
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.txt$/i,
        type: 'asset/source', // replaced raw-loader
        generator: {
          filename: '[path][name][ext]',
        },
      },
      {
        test: /\.(jpg|png|xlsx|xls|csv)$/i,
        type: 'asset/resource', // replaced file-loader
        generator: {
          filename: '[path][name][ext]',
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(svg)$/i,
        type: 'asset/inline', // replaced file-loader
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
        type: 'asset/resource', // replaced url-loader
        generator: {
          filename: '[path][name][ext]',
        },
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
          },
          {
            loader: 'css-loader',
            options: {
              sourceMap: true,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [],
              },
            },
          },
          'resolve-url-loader',
          'sass-loader',
        ],
      },
    ],
  },

  plugins: [
    // Plugin to not generate js bundle for manifest entry
    new WextManifestWebpackPlugin(),
    // Generate sourcemaps
    new webpack.SourceMapDevToolPlugin({ filename: false }),
    new ForkTsCheckerWebpackPlugin(),
    // environmental variables
    new webpack.DefinePlugin({
      NODE_ENV: JSON.stringify(nodeEnv),
      TARGET_BROWSER: JSON.stringify(targetBrowser),
    }),

    new HtmlWebpackPlugin({
      template: path.join(viewsPath, 'app.html'),
      inject: 'body',
      chunks: ['app'],
      hash: true,
      filename: 'app.html',
    }),
    new HtmlWebpackPlugin({
      template: path.join(viewsPath, 'external.html'),
      inject: 'body',
      chunks: ['external'],
      hash: true,
      filename: 'external.html',
    }),
    new HtmlWebpackPlugin({
      template: path.join(viewsPath, 'trezor-usb-permissions.html'),
      filename: 'trezor-usb-permissions.html',
      inject: 'body',
      chunks: ['trezorUSB'],
    }),
    // write css file(s) to build folder
    new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    // copy static assets
    new CopyWebpackPlugin({
      patterns: [{ from: 'source/assets', to: 'assets' }],
    }),
    new NodePolyfillPlugin()
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
        // in webpack v5, this configuration is moved to the `optimization.minimizer.terserOptions` property
        extractComments: false,
      }),
      new ZipPlugin({
        path: destPath,
        extension: `${getExtensionFileType(targetBrowser)}`,
        filename: `${targetBrowser}`,
      }),
    ],
  },
  devServer: {
    port: 9090,
    hot: true,
    compress: true,
    watchFiles: {
      paths: [sourcePath],
    },
  },
};
