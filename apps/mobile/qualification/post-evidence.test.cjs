const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { POST_REQUIRED_MAPPED_SOURCES, assertPostMappedSources } = require('./post-evidence.cjs');
const fixture = () => ({ version: 3, sources: POST_REQUIRED_MAPPED_SOURCES.map(path => `/${path.replace(/^apps\/mobile\//, '')}`),
  sourcesContent: POST_REQUIRED_MAPPED_SOURCES.map(path => `exact ${path}`) });
const expected = path => Buffer.from(`exact ${path}`);
test('POST map qualification retains every prior project source plus the shared wallet modules', () => {
  assert.equal(POST_REQUIRED_MAPPED_SOURCES.length, 77);
  assert.equal(assertPostMappedSources(fixture(), expected), 77);
  for (let index = 0; index < 77; index++) {
    const map = fixture(); map.sources.splice(index, 1); map.sourcesContent.splice(index, 1);
    assert.throws(() => assertPostMappedSources(map, expected), /MISSING/);
  }
});
test('map content mismatch, duplicates and unrecognized project paths cannot be hidden by counts', () => {
  for (const change of [map => { map.sourcesContent[0] += 'changed'; }, map => { map.sources[0] = map.sources[1]; },
    map => { map.sources[0] = '/src/../secret'; }, map => { map.sourcesContent.pop(); }]) {
    const map = fixture(); change(map); assert.throws(() => assertPostMappedSources(map, expected));
  }
});
