const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const optimization = {
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
};

module.exports = optimization;
