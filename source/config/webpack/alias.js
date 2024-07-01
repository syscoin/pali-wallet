const { resolve } = require('path');

const alias = {
  assets: resolve(__dirname, '../../../source/assets'),
  components: resolve(__dirname, '../../../source/components'),
  scripts: resolve(__dirname, '../../../source/scripts'),
  containers: resolve(__dirname, '../../../source/containers'),
  pages: resolve(__dirname, '../../../source/pages'),
  routers: resolve(__dirname, '../../../source/routers'),
  state: resolve(__dirname, '../../../source/state'),
  constants: resolve(__dirname, '../../../source/constants'),
  services: resolve(__dirname, '../../../source/services'),
  hooks: resolve(__dirname, '../../../source/hooks'),
  utils: resolve(__dirname, '../../../source/utils'),
  helpers: resolve(__dirname, '../../../source/helpers'),
};

module.exports = alias;
