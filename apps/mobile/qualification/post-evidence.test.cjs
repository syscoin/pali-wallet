/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const { POST_REQUIRED_MAPPED_SOURCES, assertPostMappedSources } = require('./post-evidence.cjs');
const fixture = () => ({ version: 3, sources: POST_REQUIRED_MAPPED_SOURCES.map(path => `/${path.replace(/^apps\/mobile\//, '')}`),
  sourcesContent: POST_REQUIRED_MAPPED_SOURCES.map(path => `exact ${path}`) });
const expected = path => Buffer.from(`exact ${path}`);
test('POST map qualification requires each current shared/native graph module', () => {
  assert.equal(assertPostMappedSources(fixture(), expected), POST_REQUIRED_MAPPED_SOURCES.length);
  for (let index = 0; index < POST_REQUIRED_MAPPED_SOURCES.length; index++) {
    const map = fixture(); map.sources.splice(index, 1); map.sourcesContent.splice(index, 1);
    assert.throws(() => assertPostMappedSources(map, expected), /MISSING/);
  }
});
test('required map sources exist in this checkout and retain the shared replacements', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const source of POST_REQUIRED_MAPPED_SOURCES) {
    assert(fs.lstatSync(path.join(root, source)).isFile(), source);
  }
  for (const source of ['source/shared/evmNetworks.ts', 'source/shared/networkText.ts',
    'source/shared/evmFeeGuard.ts',
    'apps/mobile/src/custody/networkContext.ts', 'apps/mobile/src/custody/evmFeeContracts.ts',
    'source/wallet/evmSignedRecords.ts', 'source/wallet/evmSignedReplay.ts']) {
    assert(POST_REQUIRED_MAPPED_SOURCES.includes(source), source);
  }
  assert(!POST_REQUIRED_MAPPED_SOURCES.includes('apps/mobile/src/custody/evmTransferProfiles.ts'));
  assert(!POST_REQUIRED_MAPPED_SOURCES.includes('apps/mobile/src/core/networks.ts'));
});
test('map content mismatch, duplicates and unrecognized project paths cannot be hidden by counts', () => {
  for (const change of [map => { map.sourcesContent[0] += 'changed'; }, map => { map.sources[0] = map.sources[1]; },
    map => { map.sources[0] = '/src/../secret'; }, map => { map.sourcesContent.pop(); }]) {
    const map = fixture(); change(map); assert.throws(() => assertPostMappedSources(map, expected));
  }
});
test('native module map paths retain exact contents and project path restrictions', () => {
  const modules = ['pali-walletconnect-socket/index.ts', 'pali-walletconnect-socket/socket.ts',
    'pali-private-prover/index.ts', 'pali-private-prover/runner.ts'];
  const mapped = () => {
    const map = fixture();
    for (const module of modules) {
      map.sources.push(`/modules/${module}`);
      map.sourcesContent.push(`exact apps/mobile/modules/${module}`);
    }
    return map;
  };
  assert.equal(assertPostMappedSources(mapped(), expected), POST_REQUIRED_MAPPED_SOURCES.length + modules.length);
  const index = POST_REQUIRED_MAPPED_SOURCES.length;
  for (const change of [map => { map.sourcesContent[index] += 'changed'; },
    map => { map.sources[index + 1] = map.sources[index]; },
    map => { map.sources[index] = '/modules/../secret'; },
    map => { map.sources[index] = '/modules-other/index.ts'; },
    map => { map.sourcesContent[index] = null; }]) {
    const map = mapped(); change(map);
    assert.throws(() => assertPostMappedSources(map, expected));
  }
});
