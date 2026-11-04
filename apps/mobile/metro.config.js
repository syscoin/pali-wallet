const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'ios' || platform === 'android') {
    if (moduleName === 'crypto' || moduleName === 'node:crypto') moduleName = 'react-native-quick-crypto';
    if (moduleName === 'buffer' || moduleName === 'node:buffer') moduleName = '@craftzdog/react-native-buffer';
    if (moduleName === 'stream' || moduleName === 'node:stream') moduleName = 'readable-stream';
    if (moduleName === 'assert' || moduleName === 'node:assert') moduleName = 'assert/';
    if (['http', 'https', 'zlib', 'url', 'node:http', 'node:https', 'node:zlib', 'node:url'].includes(moduleName)) {
      return { type: 'sourceFile', filePath: path.resolve(__dirname, 'src/platform/unsupportedNodeTransport.native.js') };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
