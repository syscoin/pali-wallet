const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
const mobileRoot = __dirname;
const sharedSourceRoot = path.resolve(__dirname, '../../source') + path.sep;
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
  // React and its renderers must be singletons even inside a hoisted package
  // such as react-i18next. The extension uses a different React installation.
  const renderer = ['react', 'react-dom', 'react-native'].some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  // Other package-internal imports retain their normal dependency hierarchy.
  if (renderer || !moduleName.startsWith('.') && !path.isAbsolute(moduleName) && context.originModulePath.startsWith(sharedSourceRoot)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(mobileRoot, 'package.json') }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
