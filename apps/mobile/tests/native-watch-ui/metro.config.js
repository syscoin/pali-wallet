const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const mobileRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
const sharedSourceRoot = path.resolve(mobileRoot, '../../source') + path.sep;
config.watchFolders = [path.resolve(mobileRoot, '../..')];
config.resolver.nodeModulesPaths = [path.join(mobileRoot, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  const local = (name) => ({ type: 'sourceFile', filePath: path.join(__dirname, name) });
  if (origin === path.join(mobileRoot, 'App.tsx') && moduleName === './src/platform') return local('platform.ts');
  if (origin === path.join(mobileRoot, 'App.tsx') && moduleName === './src/screens/NativeWallet') {
    return { type: 'sourceFile', filePath: path.join(mobileRoot, 'src/screens/NativeWallet.native.tsx') };
  }
  if (origin.endsWith('/src/screens/NativeWallet.native.tsx') && moduleName === '../platform/nativeFactory') return local('nativeFactory.ts');
  if (origin.endsWith('/src/screens/NativeWallet.native.tsx') && moduleName === '../platform/privacyShield.native') return local('privacy.ts');
  if (origin.endsWith('/src/screens/NativeRecovery.tsx') && moduleName.includes('findNodeHandle')) return local('recoveryNativeUi.ts');
  // Shared extension modules use mobile dependencies; package-internal imports
  // retain normal hierarchy so nested, incompatible dependency versions work.
  if (!moduleName.startsWith('.') && !path.isAbsolute(moduleName) && context.originModulePath.startsWith(sharedSourceRoot)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(mobileRoot, 'package.json') }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
