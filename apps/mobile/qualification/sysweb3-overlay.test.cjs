const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const manifest = require('../../../scripts/sysweb3-overlay.json');
const { identity } = require('../../../scripts/apply-sysweb3-overlay.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture({ decodedLimit, compressedLimit } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-sdk-overlay-'));
  const scripts = path.join(root, 'scripts'); fs.mkdirSync(scripts);
  const output = {}, packages = [];
  for (const name of ['keyring', 'network', 'utils']) {
    const pkg = `@sidhujag/sysweb3-${name}`, directory = path.join(root, 'node_modules', pkg);
    fs.mkdirSync(path.join(directory, 'cjs'), { recursive: true });
    const metadata = JSON.stringify({ name: pkg, version: '1.0.0', ...(name === 'keyring' ? { dependencies: { '@sidhujag/sysweb3-network': '1.0.0' } } : {}) });
    const before = `original ${name}`, after = `reviewed ${name}`, added = `new reviewed ${name}`;
    fs.writeFileSync(path.join(directory, 'package.json'), metadata);
    fs.writeFileSync(path.join(directory, 'cjs/runtime.js'), before);
    const files = [
      { path: 'package.json', before: hash(metadata), after: hash(metadata), beforeBytes: metadata.length, bytes: metadata.length },
      { path: 'cjs/runtime.js', before: hash(before), after: hash(after), beforeBytes: before.length, bytes: after.length },
      { path: 'cjs/shared.js', before: null, after: hash(added), beforeBytes: null, bytes: added.length },
    ];
    output[`${pkg}/cjs/runtime.js`] = after; output[`${pkg}/cjs/shared.js`] = added;
    packages.push({ name: pkg, version: '1.0.0', files });
  }
  const raw = Buffer.from(JSON.stringify(output)), payload = deflateRawSync(raw);
  fs.writeFileSync(path.join(scripts, 'sysweb3-overlay.deflate'), payload);
  fs.writeFileSync(path.join(scripts, 'sysweb3-overlay.json'), JSON.stringify({ source: { commit: 'a'.repeat(40) },
    payload: { file: 'sysweb3-overlay.deflate', compressedBytes: compressedLimit ?? payload.length,
      bytes: decodedLimit ?? raw.length, sha256: hash(payload), decodedSha256: hash(raw), files: Object.keys(output).length }, packages }));
  const installer = path.join(scripts, 'apply-sysweb3-overlay.cjs');
  fs.copyFileSync(require.resolve('../../../scripts/apply-sysweb3-overlay.cjs'), installer);
  const api = require(installer);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ paliSysweb3Overlay: api.identity }));
  return { root, output, packages, ...api, file: (name = 'keyring', file = 'cjs/runtime.js') => path.join(root, 'node_modules', `@sidhujag/sysweb3-${name}`, file),
    close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the exact reviewed SDK overlay binds both host pins and every decoded artifact', () => {
  assert.equal(manifest.source.commit, '6b362540d1a73bc6d48111d3f96456503261407a');
  assert.equal(manifest.source.compiler, 'typescript@5.9.3');
  for (const file of ['../../../package.json', '../package.json']) assert.equal(require(file).paliSysweb3Overlay, identity);
  const compressed = fs.readFileSync(require.resolve('../../../scripts/sysweb3-overlay.deflate'));
  assert.equal(compressed.length, manifest.payload.compressedBytes); assert.equal(hash(compressed), manifest.payload.sha256);
  const raw = inflateRawSync(compressed, { maxOutputLength: manifest.payload.bytes });
  assert.equal(raw.length, manifest.payload.bytes); assert.equal(hash(raw), manifest.payload.decodedSha256);
  const output = JSON.parse(raw);
  assert.equal(Object.keys(output).length, manifest.payload.files);
  for (const pkg of manifest.packages) for (const file of pkg.files) if (file.before !== file.after) {
    const artifact = Buffer.from(output[`${pkg.name}/${file.path}`]);
    assert.equal(artifact.length, file.bytes); assert.equal(hash(artifact), file.after);
    assert.doesNotMatch(artifact.toString('utf8'), /file:\/\/|\/(?:private\/tmp|Users)\//);
  }
  assert(Object.keys(output).some(key => key.endsWith('/esm/ledger/dmk-evm.js')));
  assert(Object.keys(output).some(key => key.endsWith('sysweb3-network/cjs/rpc-transport.js')));
  assert(Object.keys(output).some(key => key.endsWith('sysweb3-utils/types/tokens.d.ts')));
});

test('pristine packages apply idempotently and verify all three complete runtime inventories', () => {
  const f = fixture();
  try {
    assert.throws(() => f.verifySysweb3Overlay(f.root), /unexpected bytes/);
    f.applySysweb3Overlay(f.root); f.applySysweb3Overlay(f.root);
    assert.equal(f.verifySysweb3Overlay(f.root), f.identity);
    for (const [relative, value] of Object.entries(f.output)) assert.equal(fs.readFileSync(path.join(f.root, 'node_modules', relative), 'utf8'), value);
    fs.writeFileSync(f.file('utils', 'cjs/unreviewed.js'), 'unexpected');
    assert.throws(() => f.verifySysweb3Overlay(f.root), /unexpected artifact/);
  } finally { f.close(); }
});

test('a drifted later package or provenance rejects before the first package changes', () => {
  for (const drift of ['runtime', 'version', 'provenance']) {
    const f = fixture();
    try {
      if (drift === 'runtime') fs.writeFileSync(f.file('utils'), 'unreviewed');
      if (drift === 'version') fs.writeFileSync(f.file('utils', 'package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-utils', version: '2.0.0' }));
      if (drift === 'provenance') fs.writeFileSync(path.join(f.root, 'package.json'), '{}');
      assert.throws(() => f.applySysweb3Overlay(f.root), /unexpected bytes|requires/);
      assert.equal(fs.readFileSync(f.file(), 'utf8'), 'original keyring');
    } finally { f.close(); }
  }
});

test('partial reviewed files and exact owned crash temporaries recover without accepting foreign bytes', () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.file(), 'reviewed keyring');
    const temporary = `${f.file('network')}.pali-sysweb3-12345`;
    fs.writeFileSync(temporary, 'reviewed network');
    assert.throws(() => f.verifySysweb3Overlay(f.root));
    f.applySysweb3Overlay(f.root);
    assert.equal(fs.existsSync(temporary), false); assert.equal(f.verifySysweb3Overlay(f.root), f.identity);
    fs.writeFileSync(temporary, 'foreign bytes');
    assert.throws(() => f.applySysweb3Overlay(f.root), /unexpected artifact/);
    assert.equal(fs.readFileSync(temporary, 'utf8'), 'foreign bytes');
  } finally { f.close(); }
});

test('linked package or artifact targets cannot change another installation', () => {
  for (const linked of ['package', 'file']) {
    const f = fixture();
    try {
      const target = linked === 'package' ? path.dirname(f.file('utils', 'package.json')) : f.file();
      const external = path.join(f.root, 'external'); fs.renameSync(target, external); fs.symlinkSync(external, target);
      assert.throws(() => f.applySysweb3Overlay(f.root), /linked installation/);
      if (linked === 'file') assert.equal(fs.readFileSync(external, 'utf8'), 'original keyring');
    } finally { f.close(); }
  }
});

test('compressed size and expansion limits reject before installed package writes', () => {
  for (const options of [{ compressedLimit: 512 * 1024 + 1 }, { decodedLimit: 1 }]) {
    const f = fixture(options);
    try {
      assert.throws(() => f.applySysweb3Overlay(f.root));
      assert.equal(fs.readFileSync(f.file(), 'utf8'), 'original keyring');
    } finally { f.close(); }
  }
});

test('nested SDK copies cannot shadow the verified shared transport', () => {
  const f = fixture();
  try {
    const shadow = f.file('keyring', 'node_modules/@sidhujag/sysweb3-network');
    fs.mkdirSync(shadow, { recursive: true });
    fs.writeFileSync(path.join(shadow, 'package.json'), JSON.stringify({ name: '@sidhujag/sysweb3-network', version: '1.0.0' }));
    assert.throws(() => f.applySysweb3Overlay(f.root), /shadowed dependency/);
    assert.equal(fs.readFileSync(f.file(), 'utf8'), 'original keyring');
  } finally { f.close(); }
});

test('declared SDK consumers cannot load a foreign shared transport before overlay writes', () => {
  const f = fixture();
  try {
    const consumer = '@sidhujag/sysweb3-consumer';
    const directory = path.join(f.root, 'foreign', consumer);
    fs.mkdirSync(path.join(directory, 'node_modules/@sidhujag/sysweb3-network'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: consumer,
      dependencies: { '@sidhujag/sysweb3-network': '1.0.0' } }));
    fs.writeFileSync(path.join(directory, 'node_modules/@sidhujag/sysweb3-network/package.json'),
      JSON.stringify({ name: '@sidhujag/sysweb3-network', version: '1.0.0' }));
    fs.symlinkSync(directory, path.join(f.root, 'node_modules', consumer));
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ paliSysweb3Overlay: f.identity,
      dependencies: { [consumer]: '1.0.0' } }));
    assert.throws(() => f.applySysweb3Overlay(f.root), /shadowed dependency/);
    assert.equal(fs.readFileSync(f.file(), 'utf8'), 'original keyring');
  } finally { f.close(); }
});

test('Webpack-only ancestor shadows cannot bypass Node resolution verification', () => {
  const f = fixture();
  try {
    const foreign = path.join(f.root, 'foreign-node-modules');
    const packageFile = '@sidhujag/sysweb3-network/package.json';
    fs.mkdirSync(path.dirname(path.join(foreign, packageFile)), { recursive: true });
    fs.writeFileSync(path.join(foreign, packageFile), JSON.stringify({ name: '@sidhujag/sysweb3-network', version: '1.0.0' }));
    const shadow = path.join(f.root, 'node_modules/node_modules');
    fs.symlinkSync(foreign, shadow);
    const issuer = path.dirname(f.file('keyring'));
    assert.equal(require.resolve(packageFile, { paths: [issuer] }), fs.realpathSync(path.join(f.root, 'node_modules', packageFile)));
    assert.notEqual(fs.realpathSync(path.join(shadow, packageFile)), fs.realpathSync(path.join(f.root, 'node_modules', packageFile)));
    assert.throws(() => f.applySysweb3Overlay(f.root), /shadowed dependency/);
    assert.equal(fs.readFileSync(f.file(), 'utf8'), 'original keyring');
    fs.unlinkSync(shadow);
    f.applySysweb3Overlay(f.root);
    assert.equal(f.verifySysweb3Overlay(f.root), f.identity);
  } finally { f.close(); }
});
