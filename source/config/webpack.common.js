/* eslint-disable @typescript-eslint/no-var-requires */

const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { join, resolve } = require('path');
const { DefinePlugin, IgnorePlugin, ProvidePlugin } = require('webpack');

const viewsPath = join(__dirname, '../../views');
const sourcePath = join(__dirname, '../../source');
const destPath = join(__dirname, '../../build');
const targetBrowser = process.env.TARGET_BROWSER || 'chrome';
const passkeyGuardianShortRecoveryDelaySeconds = Number(
  process.env.PASSKEY_GUARDIAN_SHORT_RECOVERY_DELAY_SECONDS || 0
);

module.exports = {
  entry: {
    background: join(sourcePath, 'scripts/Background', 'index.ts'),
    inpage: join(sourcePath, 'scripts/ContentScript', 'inject/inpage.ts'),
    pali: join(sourcePath, 'scripts/ContentScript', 'inject/pali.ts'),
    handleWindowProperties: join(
      sourcePath,
      'scripts/ContentScript',
      'inject/handleWindowProperties.ts'
    ),
    contentScript: join(sourcePath, 'scripts/ContentScript', 'index.ts'),
    slhDsaOffscreen: join(sourcePath, 'scripts/slhDsa', 'offscreen.ts'),
    app: join(sourcePath, 'pages/App', 'index.tsx'),
    external: join(sourcePath, 'pages/External', 'index.tsx'),
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
      types: resolve(__dirname, '../../source/types'),
      utils: resolve(__dirname, '../../source/utils'),
      helpers: resolve(__dirname, '../../source/helpers'),
      // Drop Ledger's embedded ERC-20 signature dataset (~130KB); it is only
      // the offline fallback - resolveTransaction fetches the live list from
      // the Ledger CDN by default. See stub for details.
      '@ledgerhq/cryptoassets-evm-signatures/data/evm/index$': resolve(
        __dirname,
        'stubs/ledger-erc20-signatures.js'
      ),
      // Ensure consistent process resolution across all modules
      'process/browser.js': require.resolve('process/browser.js'),
      'process/browser': require.resolve('process/browser.js'),
      process: require.resolve('process/browser.js'),
    },
    fallback: {
      fs: false,
      // Only polyfill what's absolutely necessary
      buffer: require.resolve('buffer/'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      path: false,
      os: false,
      process: require.resolve('process/browser.js'),
    },
  },
  module: {
    rules: [
      {
        test: /\.(jpg|png|svg|webp|xlsx|xls|csv)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/all_assets/[name][ext]',
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(ttf|woff2)$/,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[name][ext]',
        },
      },
      {
        test: /\.(sa|sc|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader',
          'sass-loader',
        ],
      },
      {
        test: /\.(js|ts)x?$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
        options: {
          cacheDirectory: true,
          cacheCompression: false,
        },
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
    ],
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin({
      typescript: {
        memoryLimit: 4096,
      },
    }),
    new DefinePlugin({
      NODE_ENV: JSON.stringify(process.env.NODE_ENV),
      'process.env.PASSKEY_GUARDIAN_SHORT_RECOVERY_DELAY_SECONDS':
        JSON.stringify(
          Number.isFinite(passkeyGuardianShortRecoveryDelaySeconds) &&
            passkeyGuardianShortRecoveryDelaySeconds > 0
            ? String(Math.floor(passkeyGuardianShortRecoveryDelaySeconds))
            : ''
        ),
      TARGET_BROWSER: JSON.stringify(targetBrowser),
    }),
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
    // bip39 loads every wordlist inside try/catch specifically so bundlers can
    // drop the ones they don't need. We only support English mnemonics; with
    // only english.json present bip39 sets it as the default wordlist.
    // Saves ~265KB of JSON in the background bundle.
    new IgnorePlugin({
      resourceRegExp: /^\.\/wordlists\/(?!english\.json)/,
      contextRegExp: /bip39[/\\]src$/,
    }),
    new NodePolyfillPlugin({
      excludeAliases: ['console'],
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'app.html'),
      inject: 'body',
      chunks: ['vendor', 'sysweb3', 'app'],
      hash: true,
      filename: 'app.html',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'offscreen.html'),
      inject: 'body',
      chunks: ['vendor', 'slhDsaOffscreen'],
      hash: true,
      filename: 'offscreen.html',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'external.html'),
      inject: 'body',
      chunks: ['vendor', 'sysweb3', 'external'],
      hash: true,
      filename: 'external.html',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),

    new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    // Copy assets, excluding only imported image files to prevent duplication
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'source/assets/all_assets',
          to: 'assets/all_assets',
          globOptions: {
            ignore: [],
          },
        },
        {
          from: 'source/assets/locales',
          to: 'assets/locales',
          globOptions: {
            ignore: [],
          },
        },
        {
          from: 'source/assets/fonts/index.css',
          to: 'assets/fonts/index.css',
        },
        {
          from: 'source/assets/js',
          to: 'assets/js',
          globOptions: {
            ignore: [],
          },
        },
        {
          from: 'source/assets/slh-dsa',
          to: 'assets/slh-dsa',
          globOptions: {
            ignore: [],
          },
        },
        {
          from: 'source/scripts/offscreen-setup.js',
          to: 'source/scripts/offscreen-setup.js',
        },
      ],
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: './manifest.json',
          to: join(__dirname, '../../build', targetBrowser),
          force: true,
          transform: function (content) {
            try {
              const manifestObject = JSON.parse(content.toString());
              return Buffer.from(JSON.stringify(manifestObject, null, 2));
            } catch (e) {
              console.error('Error transforming manifest.json:', e);
              return content;
            }
          },
        },
      ],
    }),
  ],
  optimization: {
    splitChunks: {
      chunks(chunk) {
        // Only split chunks for app and external, NOT background, contentScript, inpage, pali, or handleWindowProperties
        return (
          chunk.name === 'app' ||
          chunk.name === 'vendor' ||
          chunk.name === 'sysweb3' ||
          chunk.name === 'external'
        );
      },
    },
  },
  // Performance hints
  performance: {
    hints: 'warning',
    maxEntrypointSize: 512000,
    maxAssetSize: 512000,
  },
};
