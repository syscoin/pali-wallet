const path = require('node:path');
const rootDir = path.resolve(__dirname, '../../..');
const ordinary = require(path.join(rootDir, 'jest.config.json'));

module.exports = {
  ...ordinary,
  rootDir,
  roots: [__dirname],
  collectCoverage: false,
  moduleDirectories: ['node_modules'],
  modulePaths: [
    path.join(rootDir, 'source'),
    path.join(rootDir, 'node_modules'),
  ],
  moduleFileExtensions: [...ordinary.moduleFileExtensions, 'cjs'],
  testPathIgnorePatterns: ['/node_modules/'],
  // The ordinary asset-test setup replaces crypto APIs. This integration must
  // keep all EVM cryptography real; only Chrome shell APIs need the common shim.
  setupFilesAfterEnv: [
    path.join(rootDir, 'jest.setup.js'),
    path.join(__dirname, 'nativeRealm.cjs'),
  ],
};
