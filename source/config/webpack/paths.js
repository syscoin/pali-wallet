const { join } = require('path');

const paths = {
  viewsPath: join(__dirname, '../../../views'),
  sourcePath: join(__dirname, '../../../source'),
  destPath: join(__dirname, '../../../build'),
};

module.exports = paths;
