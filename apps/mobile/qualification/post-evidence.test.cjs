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
