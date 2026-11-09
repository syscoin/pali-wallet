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
const module = { exports: {} as { resolver: { resolveRequest: (context: any, name: string, platform: string) => any } } };
runInNewContext(readFileSync(path.join(mobileRoot, 'metro.config.js'), 'utf8'), {
  __dirname: mobileRoot, module,
  require(name: string) {
    if (name === 'path') return path;
    assert.equal(name, 'expo/metro-config');
    return { getDefaultConfig: () => ({ resolver: {} }) };
  },
});
const resolve = module.exports.resolver.resolveRequest;

for (const platform of ['android', 'ios', 'web']) test(`${platform} hoisted hook packages use the mobile React and renderer singletons`, () => {
  // Use real package resolution, including the installed translation hook's
  // origin: a second React dispatcher previously crashed Welcome here.
  const origin = appRequire.resolve('react-i18next');
  for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/server', 'react-native']) {
    const actual = resolve({ originModulePath: origin,
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
