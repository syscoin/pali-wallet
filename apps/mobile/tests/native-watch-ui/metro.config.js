const path = require('node:path');
const fs = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');
const mobileRoot = path.resolve(__dirname, '../..');
const dependencies = fs.realpathSync(path.join(mobileRoot, 'node_modules'));
const config = getDefaultConfig(__dirname);
const sharedSourceRoot = path.resolve(mobileRoot, '../../source') + path.sep;
config.watchFolders = [path.resolve(mobileRoot, '../..'), dependencies];
config.resolver.nodeModulesPaths = [dependencies];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (['./src/platform/security', '../platform/security', './platform/security', './security'].includes(moduleName)) return { type: 'sourceFile', filePath: path.join(__dirname, 'security.ts') };
  const local = (name) => ({ type: 'sourceFile', filePath: path.join(__dirname, name) });
  if (origin.endsWith('/src/screens/WalletUpdatePanel.tsx') && moduleName === '../platform/appUpdates') return local('appUpdates.ts');
  if (origin === path.join(mobileRoot, 'App.tsx') && moduleName === './src/platform') return local('platform.ts');
  if (origin === path.join(mobileRoot, 'App.tsx') && moduleName === './src/screens/NativeWallet') {
    return { type: 'sourceFile', filePath: path.join(mobileRoot, 'src/screens/NativeWallet.native.tsx') };
  }
  if (origin.endsWith('/src/screens/NativeWallet.native.tsx') && moduleName === '../platform/nativeFactory') return local('nativeFactory.ts');
  if (moduleName === '../platform/portfolioFilter') return local('portfolioFilter.ts');
  if (origin.endsWith('/src/screens/NativeWallet.native.tsx') && moduleName === '../platform/privacyShield.native') return local('privacy.ts');
  if (origin.endsWith('/src/screens/NativeRecovery.tsx') && moduleName.includes('findNodeHandle')) return local('recoveryNativeUi.ts');
  // Shared extension modules use mobile dependencies; package-internal imports
  // retain normal hierarchy so nested, incompatible dependency versions work.
  const renderer = ['react', 'react-dom', 'react-native'].some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  if (renderer || !moduleName.startsWith('.') && !path.isAbsolute(moduleName) && context.originModulePath.startsWith(sharedSourceRoot)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(mobileRoot, 'package.json') }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
