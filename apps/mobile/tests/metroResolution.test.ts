import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const mobileRoot = fileURLToPath(new NodeURL('../', import.meta.url));
const appRequire = createRequire(path.join(mobileRoot, 'package.json'));
const repository = path.resolve(mobileRoot, '../..');
function resolver(relative: string) {
  const file = path.join(mobileRoot, relative);
  const module = { exports: {} as { resolver: { resolveRequest: (context: any, name: string, platform: string) => any } } };
  runInNewContext(readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), module,
    require(name: string) {
      if (name === 'path' || name === 'node:path') return path;
      assert.equal(name, 'expo/metro-config');
      return { getDefaultConfig: () => ({ resolver: {} }) };
    },
  });
  return module.exports.resolver.resolveRequest;
}
const resolve = resolver('metro.config.js');
const fixtureResolve = resolver('tests/native-watch-ui/metro.config.js');

for (const [label, selected] of [['production', resolve], ['watch fixture', fixtureResolve]] as const)
for (const platform of ['android', 'ios', 'web']) test(`${label} ${platform} hoisted hook packages use the mobile React and renderer singletons`, () => {
  // Use real package resolution, including the installed translation hook's
  // origin: a second React dispatcher previously crashed Welcome here.
  const origin = appRequire.resolve('react-i18next');
  for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/server', 'react-native']) {
    const actual = selected({ originModulePath: origin,
      resolveRequest(context: { originModulePath: string }, request: string) {
        assert.equal(context.originModulePath, path.join(mobileRoot, 'package.json'));
        return { filePath: createRequire(context.originModulePath).resolve(request) };
      },
    }, name, platform);
    assert.equal(actual.filePath, appRequire.resolve(name), name);
  }
});

test('nested non-renderer dependencies keep their own hierarchy, while shared modules use mobile dependencies', () => {
  const nested = path.join(repository, 'node_modules/nested-library/index.js');
  const shared = path.join(repository, 'source/utils/shared.ts');
  const dispatch = (originModulePath: string, name: string, platform: string) => resolve({ originModulePath,
    resolveRequest(context: { originModulePath: string }, request: string) {
      return { origin: context.originModulePath, request };
    },
  }, name, platform);
  for (const name of ['@noble/curves', 'react-native-quick-crypto', './child', '../child'])
    assert.equal(dispatch(nested, name, 'android').origin, nested);
  assert.equal(dispatch(shared, '@noble/curves', 'android').origin, path.join(mobileRoot, 'package.json'));
  assert.equal(dispatch(shared, './child', 'android').origin, shared);
  assert.equal(dispatch(nested, 'crypto', 'android').request, 'react-native-quick-crypto');
  assert.equal(dispatch(nested, 'crypto', 'web').request, 'crypto');
});

test('watch fixture retains scoped host aliases and normal non-renderer dependency hierarchy', () => {
  const nested = path.join(repository, 'node_modules/nested-library/index.js');
  const dispatch = (originModulePath: string, name: string) => fixtureResolve({originModulePath,
    resolveRequest(context: {originModulePath:string}, request:string) { return {origin:context.originModulePath,request}; }
  },name,'web');
  for (const name of ['@noble/curves','crypto','./child','../child']) assert.equal(dispatch(nested,name).origin,nested);
  assert.equal(dispatch(path.join(repository,'source/utils/shared.ts'),'@noble/curves').origin,path.join(mobileRoot,'package.json'));
  assert.equal(dispatch(path.join(mobileRoot,'src/screens/NativeWallet.native.tsx'),'../platform/nativeFactory').filePath,path.join(mobileRoot,'tests/native-watch-ui/nativeFactory.ts'));
  assert.equal(dispatch(path.join(mobileRoot,'src/screens/NativeWallet.native.tsx'),'../platform/security').filePath,path.join(mobileRoot,'tests/native-watch-ui/security.ts'));
});
