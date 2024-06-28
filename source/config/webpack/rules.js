const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const rules = [
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
];

module.exports = rules;
