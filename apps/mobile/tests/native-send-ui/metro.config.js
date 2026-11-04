const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const mobileRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(mobileRoot, '../..')];
config.resolver.nodeModulesPaths = [path.join(mobileRoot, 'node_modules')];
module.exports = config;
