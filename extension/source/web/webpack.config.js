/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const fs = require('fs');

const webpack = require('webpack');
const DotEnv = require('dotenv-webpack');
const ZipPlugin = require('zip-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const ExtensionReloader = require('webpack-extension-reloader');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const WextManifestWebpackPlugin = require('wext-manifest-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const PnpWebpackPlugin = require(`pnp-webpack-plugin`);

const viewsPath = path.join(__dirname, '../../views');
const sourcePath = path.join(__dirname, '../');
const destPath = path.join(__dirname, 'extension');
const rootPath = path.join(__dirname, '../../');
const sharedPath = path.join(__dirname, '../');
const typeScriptPath = path.join(__dirname, '../../node_modules/typescript');
const nodeEnv = process.env.NODE_ENV || 'development';
const targetBrowser = process.env.TARGET_BROWSER;

const extensionReloaderPlugin =
  nodeEnv === 'development'
    ? new ExtensionReloader({
        port: 9090,
        reloadPage: true,
        entries: {
          // TODO: reload manifest on update
          contentScript: 'contentScript',
          background: 'background',
          inpage: 'inpage',
          extensionPage: ['popup'],
          trezorScript: 'trezorScript'
        },
      })
    : () => {
        this.apply = () => {};
      };

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
  devtool: false, // https://github.com/webpack/webpack/issues/1194#issuecomment-560382342

  stats: {
    all: false,
    builtAt: true,
    errors: true,
    hash: true,
  },
  
  node: {
    fs: "empty"
  },

  mode: nodeEnv,

  entry: {
    manifest: path.join(__dirname, 'manifest.json'),
    webextension: path.join(__dirname, 'node_modules', 'webextension-polyfill-ts', 'lib/index.js'),
    background: path.join(sourcePath, 'scripts/Background', 'index.ts'),
    inpage: path.join(sourcePath, 'scripts/ContentScript', 'inpage.ts'),
    contentScript: path.join(sourcePath, 'scripts/ContentScript', 'index.ts'),
    trezorScript: path.join(sourcePath, 'vendor', 'trezor-content-script.js'),
    app: path.join(sourcePath, 'pages/App', 'index.tsx'),
    trezorUSB: path.join(sourcePath, 'vendor', 'trezor-usb-permissions.js')
  },

  output: {
    path: path.join(destPath, targetBrowser),
    filename: 'js/[name].bundle.js',
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      'webextension-polyfill-ts': path.resolve(
        path.join(__dirname, 'node_modules', 'webextension-polyfill-ts')
      ),
      assets: path.resolve(__dirname, '../../source/assets'),
      components: path.resolve(__dirname, '../../source/components'),
      scripts: path.resolve(__dirname, '../../source/scripts'),
      containers: path.resolve(__dirname, '../../source/containers'),
      pages: path.resolve(__dirname, '../../source/pages'),
      routers: path.resolve(__dirname, '../../source/routers'),
      state: path.resolve(__dirname, '../../source/state'),
      constants: path.resolve(__dirname, '../../source/constants'),
      services: path.resolve(__dirname, '../../source/services'),
      hooks: path.resolve(__dirname, '../../source/hooks'),
      fs: require.resolve("fs-extra"),
    },
  },
  resolveLoader: {
    plugins: [
      PnpWebpackPlugin.moduleLoader(module),
    ],
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
        exclude: [/node_modules/,  /native/],
      },
      {
        test: /\.(js|ts)x?$/,
        loader: 'babel-loader',
        exclude: [/node_modules/, /native/], // Exclude node_modules and react-native project folders.
        options: {
          ...JSON.parse(fs.readFileSync(path.resolve(__dirname, '.babelrc'))),
        }
      },
      {
        test: /\.(jpg|png|svg)x?$/,
        loader: 'file-loader',
      },
      {
        test: /\.txt\.ts$/,
        loader: 'raw-loader',
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          {
            loader: 'style-loader', // It creates a CSS file per JS file which contains CSS
          },
          {
            loader: 'css-loader', // Takes the CSS files and returns the CSS with imports and url(...) for Webpack
            options: {
              import: true,
              sourceMap: true,
              modules: {
                localIdentName: '[name]__[local]___[hash:base64:5]',
              },
            },
          },
          {
            loader: 'postcss-loader', // For autoprefixer
            options: {
              ident: 'postcss',
              // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
              plugins: [require('autoprefixer')()],
            },
          },
          'resolve-url-loader', // Rewrites relative paths in url() statements
          'sass-loader', // Takes the Sass/SCSS file and compiles to the CSS
        ],
      },
    ],
  },

  plugins: [
    // Plugin to not generate js bundle for manifest entry
    new WextManifestWebpackPlugin(),
    // Generate sourcemaps
    new webpack.SourceMapDevToolPlugin({ filename: false }),
    new ForkTsCheckerWebpackPlugin({
      tsconfig: path.resolve(rootPath+'tsconfig.json'),
    }),
    // environmental variables
    new webpack.EnvironmentPlugin(['NODE_ENV', 'TARGET_BROWSER']),
    // delete previous build files
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [
        path.join(process.cwd(), `extension/${targetBrowser}`),
        path.join(
          process.cwd(),
          `extension/${targetBrowser}.${getExtensionFileType(targetBrowser)}`
        ),
      ],
      cleanStaleWebpackAssets: false,
      verbose: true,
      dangerouslyAllowCleanPatternsOutsideProject: true,
    }),
    new HtmlWebpackPlugin({
      template: path.join(viewsPath, 'app.html'),
      inject: 'body',
      chunks: ['app'],
      filename: 'app.html',
    }),
    // new DotEnv({
    //   path: './.env'
    // }),
    // write css file(s) to build folder
    new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    // copy static assets
    new CopyWebpackPlugin([{ from: sharedPath+'assets', to: 'assets' }]),
    // plugin to enable browser reloading in development mode
    extensionReloaderPlugin,
  ],

  optimization: {
    minimizer: [
      new TerserPlugin({
        cache: true,
        parallel: true,
        terserOptions: {
          output: {
            comments: false,
          },
        },
        extractComments: false,
      }),
      new OptimizeCSSAssetsPlugin({
        cssProcessorPluginOptions: {
          preset: ['default', { discardComments: { removeAll: true } }],
        },
      }),
      new ZipPlugin({
        path: destPath,
        extension: `${getExtensionFileType(targetBrowser)}`,
        filename: `${targetBrowser}`,
      }),
    ],
  },
};
