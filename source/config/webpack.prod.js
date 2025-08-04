/* eslint-disable @typescript-eslint/no-var-requires */

const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const { WebpackManifestPlugin } = require('webpack-manifest-plugin');
const { merge } = require('webpack-merge');
const ZipPlugin = require('zip-webpack-plugin');

const common = require('./webpack.common');

const version = require('../../package.json').version;

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';
const environment = process.env.NODE_ENV;

module.exports = merge(common, {
  mode: 'production',
  devtool: false, // Disable source maps in production to reduce size

  optimization: {
    ...common.optimization,
    // Additional production optimizations
    usedExports: true,
    innerGraph: true,
    providedExports: true,
    concatenateModules: true,
    flagIncludedChunks: true,
    chunkIds: 'deterministic',
    moduleIds: 'deterministic',
    mangleExports: 'size',
    removeAvailableModules: true,
    removeEmptyChunks: true,
    mergeDuplicateChunks: true,

    // More aggressive minification
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
            pure_funcs: [
              'console.log',
              'console.info',
              'console.debug',
              'console.warn',
            ],
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
  },

  plugins: [
    // Generate manifest for caching
    new WebpackManifestPlugin({
      fileName: 'asset-manifest.json',
      publicPath: '/',
      generate: (seed, files, entrypoints) => {
        const manifestFiles = files.reduce((manifest, file) => {
          manifest[file.name] = file.path;
          return manifest;
        }, seed);

        const entrypointFiles = entrypoints.app.filter(
          (fileName) => !fileName.endsWith('.map')
        );

        return {
          files: manifestFiles,
          entrypoints: entrypointFiles,
        };
      },
    }),

    new ZipPlugin({
      filename: `pali-wallet-${environment}-${targetBrowser}-${version}`,
      path: path.join(__dirname, '../../build'),
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
        '../../build',
        `${targetBrowser}-report.html`
      ),
    }),
  ],
});
