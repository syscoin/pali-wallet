/* eslint-disable @typescript-eslint/no-var-requires */

const CopyWebpackPlugin = require('copy-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const { join, resolve } = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const { DefinePlugin, ProvidePlugin } = require('webpack');

const viewsPath = join(__dirname, '../../views');
const sourcePath = join(__dirname, '../../source');
const destPath = join(__dirname, '../../build');
const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

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
    app: join(sourcePath, 'pages/App', 'index.tsx'),
    external: join(sourcePath, 'pages/External', 'index.tsx'),
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
      // Only polyfill what's absolutely necessary
      buffer: require.resolve('buffer/'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      path: false,
      os: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.(jpg|png|xlsx|xls|csv)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]',
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/icons/[name][ext]',
        },
        exclude: /node_modules/,
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
      {
        test: /\.(ttf)$/,
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
      TARGET_BROWSER: JSON.stringify(targetBrowser),
    }),
    new ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
    new NodePolyfillPlugin({
      excludeAliases: ['console'],
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'app.html'),
      inject: 'body',
      chunks: ['vendor', 'app'],
      hash: true,
      filename: 'app.html',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'external.html'),
      inject: 'body',
      chunks: ['vendor', 'external'],
      hash: true,
      filename: 'external.html',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: join(viewsPath, 'offscreen.html'),
      filename: 'offscreen.html',
      inject: 'body',
      chunks: ['offscreenScript'],
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: true,
      },
    }),
    new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    new CopyWebpackPlugin({
      patterns: [{ from: 'source/assets', to: 'assets' }],
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
    minimize: true,
    minimizer: [
      new CssMinimizerPlugin(),
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          parse: {
            ecma: 8,
          },
          compress: {
            ecma: 5,
            warnings: false,
            comparisons: false,
            inline: 2,
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ['console.log', 'console.info', 'console.debug'],
          },
          mangle: {
            safari10: true,
          },
          output: {
            ecma: 5,
            comments: false,
            ascii_only: true,
          },
        },
        extractComments: false,
      }),
    ],
    // Simple vendor splitting for app and external only
    splitChunks: {
      chunks(chunk) {
        // Only split chunks for app and external, NOT background
        return chunk.name === 'app' || chunk.name === 'external';
      },
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          priority: 10,
        },
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
