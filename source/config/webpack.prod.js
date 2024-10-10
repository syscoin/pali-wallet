/* eslint-disable @typescript-eslint/no-var-requires */

const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const { join } = require('path');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const { merge } = require('webpack-merge');
const ZipPlugin = require('zip-webpack-plugin');
// const TerserPlugin = require('terser-webpack-plugin');
// const CompressionWebpackPlugin = require('compression-webpack-plugin');
const context = path.resolve(__dirname, '../../source');

const common = require('./webpack.common');

const version = require('../../package.json').version;

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin({
      filename: 'css/[name].css',
    }),
    new ZipPlugin({
      filename: `pali-wallet-${targetBrowser}-${version}.zip`,
      path: path.resolve(__dirname, '../../build'),
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
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
      },
      {
        test: /\.scss$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
      },
    ],
  },
  output: {
    wasmLoading: 'fetch',
    // required for `integrity` to work in the browser
    crossOriginLoading: 'anonymous',
    // filenames for *initial* files (essentially JS entry points)
    filename: '[name].[contenthash].js',
    // path: join(context, '../../', 'build'),
    // Clean the output directory before emit, so that only the latest build
    // files remain. Nearly 0 performance penalty for this clean up step.
    clean: true,
    // relative to HTML page. This value is essentially prepended to asset URLs
    // in the output HTML, i.e., `<script src="<publicPath><resourcePath>">`.
    // publicPath: '',
    // disabling pathinfo makes reading the bundle harder, but reduces build
    // time by 500ms+
    pathinfo: false,
  },
  optimization: {
    sideEffects: true,
    providedExports: true,
    removeAvailableModules: true,
    usedExports: true,
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    minimize: true,
    minimizer: getMinimizers(),
    runtimeChunk: {
      name: (chunk) => (canBeChunked(chunk) ? 'runtime' : false),
    },
    splitChunks: {
      // Impose a 4MB JS file size limit due to Firefox limitations
      // https://github.com/mozilla/addons-linter/issues/4942
      maxSize: 1 << 22,
      minSize: 1,
      // Optimize duplication and caching by splitting chunks by shared
      // modules and cache group.
      cacheGroups: {
        js: {
          // only our own ts/mts/tsx/js/mjs/jsx files (NOT in node_modules)
          test: /(?!.*\/node_modules\/).+\.(?:m?[tj]s|[tj]sx?)?$/u,
          name: 'js',
          chunks: canBeChunked,
        },
        vendor: {
          // js/mjs files in node_modules or subdirectories of node_modules
          test: /[\\/]node_modules[\\/].*?\.m?js$/u,
          name: 'vendor',
          chunks: canBeChunked,
        },
      },
    },
  },
  performance: { maxAssetSize: 1 << 22 },
});

function canBeChunked({ name }) {
  return !name;
}

function getMinimizers() {
  const TerserPlugin = require('terser-webpack-plugin');
  return [
    new TerserPlugin({
      // use SWC to minify (about 7x faster than Terser)
      minify: TerserPlugin.swcMinify,
    }),
  ];
}
