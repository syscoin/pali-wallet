import fs from 'fs';
import os from 'os';
import path from 'path';
import webpack from 'webpack';

import { createIdenticalDependencyDedupPlugins } from '../../source/config/plugins/deduplicateIdenticalDependencies';

const installed = (name: string, anchor?: string) =>
  require.resolve(
    name,
    anchor ? { paths: [path.dirname(require.resolve(anchor))] } : undefined
  );
const bn4 = installed('bn.js', 'asn1.js');
const bn5 = installed('bn.js');
const byteFile = (anchor?: string) =>
  path.resolve(
    path.dirname(installed('uint8array-tools', anchor)),
    '../mjs/browser.js'
  );
const bytes8 = byteFile('bip32');
const bytes10 = byteFile('bip174');
const bnAnchors = [
  'asn1.js',
  'create-ecdh',
  'diffie-hellman',
  'elliptic',
  'eth-util-lite',
  'ethereumjs-util',
  'miller-rabin',
  'public-encrypt',
  'tiny-secp256k1',
];

let directory: string;
beforeEach(() => {
  directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pali-identical-dependencies-'))
  );
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

async function compile(source: string, deduplicate = true) {
  const entry = path.join(directory, deduplicate ? 'dedup.js' : 'baseline.js');
  const output = path.join(directory, deduplicate ? 'dedup' : 'baseline');
  fs.writeFileSync(entry, source);
  const compiler = webpack({
    mode: 'development',
    target: 'web',
    devtool: false,
    context: directory,
    entry,
    output: {
      path: output,
      filename: 'bundle.cjs',
      library: { type: 'commonjs2', export: 'default' },
    },
    optimization: { minimize: false, concatenateModules: false },
    resolve: { fallback: { buffer: require.resolve('buffer/') } },
    plugins: deduplicate ? createIdenticalDependencyDedupPlugins() : [],
  });
  const stats = await new Promise<webpack.Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error || closeError) return reject(error || closeError);
        if (!result || result.hasErrors())
          return reject(
            new Error(result?.toString({ all: false, errors: true }))
          );
        resolve(result);
      });
    });
  });
  const resources = Array.from(stats.compilation.modules)
    .map((module) => (module as webpack.NormalModule).resource)
    .filter((resource): resource is string => Boolean(resource));
  const dependencies = Array.from(stats.compilation.modules).flatMap((module) =>
    Array.from(stats.compilation.moduleGraph.getOutgoingConnections(module))
      .filter((connection) => Boolean((connection.dependency as any)?.request))
      .map((connection) => ({
        from: (module as webpack.NormalModule).resource,
        request: (connection.dependency as any).request,
        resource: (connection.module as webpack.NormalModule)?.resource,
        identifier: connection.module?.identifier(),
      }))
  );
  const packageMetadata = Array.from(stats.compilation.modules)
    .filter((module) => Boolean((module as webpack.NormalModule).resource))
    .map((module) => ({
      resource: (module as webpack.NormalModule).resource,
      root: (module as webpack.NormalModule).resourceResolveData
        ?.descriptionFileRoot,
    }));
  const result = { exports: {} as any };
  // Execute only this locally compiled, dependency-only test fixture.
  new Function(
    'module',
    'exports',
    fs.readFileSync(path.join(output, 'bundle.cjs'), 'utf8')
  )(result, result.exports);
  return { resources, dependencies, packageMetadata, result: result.exports };
}

it('deduplicates the installed identical versions while preserving BN5 and newer byte tools', async () => {
  const paths = bnAnchors.map((anchor) => installed('bn.js', anchor));
  const source = `
    ${paths
      .map(
        (resource, index) =>
          `import BN${index} from ${JSON.stringify(resource)};`
      )
      .join('\n')}
    import RootBN5 from ${JSON.stringify(bn5)};
    import * as a from ${JSON.stringify(bytes8)};
    import * as b from ${JSON.stringify(byteFile('ecpair'))};
    import * as newer from ${JSON.stringify(bytes10)};
    const constructors = [${paths.map((_, index) => `BN${index}`).join(',')}];
    const value = new BN0('ffffffffffffffff', 16);
    const buffer = new Uint8Array(12);
    a.writeUInt32(buffer, 0, 0x89abcdef, 'LE');
    b.writeUInt64(buffer, 4, 0x0102030405060708n, 'BE');
    export default {
      sameBn4: constructors.every(BN => BN === BN0),
      separateBn5: RootBN5 !== BN0,
      sameBytes8: a === b,
      separateBytes10: newer.toHex !== a.toHex,
      product: value.mul(new constructors[8](2)).toString(16),
      bnBytes: Array.from(value.toArrayLike(Uint8Array, 'be', 8)),
      bn5Sum: new RootBN5('9007199254740993').addn(1).toString(),
      bytes: a.toHex(buffer),
      uint32: b.readUInt32(buffer, 0, 'LE'),
      uint64: a.readUInt64(buffer, 4, 'BE').toString(),
      newerRoundTrip: newer.toHex(newer.fromHex('00aabbff')),
    };`;
  const baseline = await compile(source, false);
  const deduplicated = await compile(source);
  const bnResources = (resources: string[]) =>
    resources.filter((resource) => /\/bn\.js\/lib\/bn\.js$/.test(resource));
  const byteResources = (resources: string[]) =>
    resources.filter((resource) =>
      /\/uint8array-tools\/src\/mjs\/browser\.js$/.test(resource)
    );
  expect(bnResources(baseline.resources)).toHaveLength(10);
  expect(bnResources(deduplicated.resources).sort()).toEqual([bn4, bn5].sort());
  expect(byteResources(baseline.resources)).toHaveLength(3);
  expect(byteResources(deduplicated.resources).sort()).toEqual(
    [bytes8, bytes10].sort()
  );
  for (const [build, count] of [
    [baseline, 9],
    [deduplicated, 1],
  ] as const) {
    const bufferEdges = build.dependencies.filter(
      (dependency) =>
        paths.includes(dependency.from) && dependency.request === 'buffer'
    );
    expect(bufferEdges).toHaveLength(count);
    for (const edge of bufferEdges) {
      expect(edge.resource).toBeUndefined();
      expect(edge.identifier).toMatch(/^ignored\|.*\|buffer$/);
    }
    expect(
      build.dependencies.filter((dependency) =>
        [bytes8, byteFile('ecpair')].includes(dependency.from)
      )
    ).toEqual([]);
  }
  expect(deduplicated.packageMetadata).toEqual(
    expect.arrayContaining([
      { resource: bn4, root: path.resolve(path.dirname(bn4), '..') },
      {
        resource: bytes8,
        root: path.resolve(path.dirname(bytes8), '../..'),
      },
    ])
  );
  expect(baseline.result).toMatchObject({ sameBn4: false, sameBytes8: false });
  expect(deduplicated.result).toEqual({
    sameBn4: true,
    separateBn5: true,
    sameBytes8: true,
    separateBytes10: true,
    product: '1fffffffffffffffe',
    bnBytes: Array(8).fill(255),
    bn5Sum: '9007199254740994',
    bytes: 'efcdab890102030405060708',
    uint32: 0x89abcdef,
    uint64: '72623859790382856',
    newerRoundTrip: '00aabbff',
  });
  expect(baseline.result).toEqual({
    ...deduplicated.result,
    sameBn4: false,
    sameBytes8: false,
  });
});

it.each([
  {
    name: 'bn.js',
    version: '4.12.4',
    otherVersion: '4.12.3',
    file: 'lib/bn.js',
    canonical: bn4,
  },
  {
    name: 'uint8array-tools',
    version: '0.0.8',
    otherVersion: '0.0.10',
    file: 'src/mjs/browser.js',
    canonical: bytes8,
  },
])(
  'keeps changed $name sources and different versions separate',
  async (dependency) => {
    const copy = (label: string, version: string, changed: boolean) => {
      const root = path.join(
        directory,
        'node_modules',
        label,
        'node_modules',
        dependency.name
      );
      const resource = path.join(root, dependency.file);
      fs.mkdirSync(path.dirname(resource), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          ...JSON.parse(
            fs.readFileSync(
              path.resolve(
                path.dirname(dependency.canonical),
                dependency.name === 'bn.js' ? '..' : '../..',
                'package.json'
              ),
              'utf8'
            )
          ),
          version,
        })
      );
      fs.writeFileSync(
        resource,
        fs.readFileSync(dependency.canonical, 'utf8') +
          (changed ? '\n// Different installed source fixture\n' : '')
      );
      return resource;
    };
    const differentVersion = copy(
      'different-version',
      dependency.otherVersion,
      false
    );
    const changedSource = copy('changed-source', dependency.version, true);
    const { resources, result } = await compile(`
    import * as canonical from ${JSON.stringify(dependency.canonical)};
    import * as differentVersion from ${JSON.stringify(differentVersion)};
    import * as changedSource from ${JSON.stringify(changedSource)};
    export default {
      versionKeptSeparate: canonical !== differentVersion,
      sourceKeptSeparate: canonical !== changedSource,
    };`);
    expect(result).toEqual({
      versionKeptSeparate: true,
      sourceKeptSeparate: true,
    });
    expect(resources).toEqual(
      expect.arrayContaining([
        dependency.canonical,
        differentVersion,
        changedSource,
      ])
    );
  }
);

it('does not merge same-source BN when its browser dependency mapping differs', async () => {
  const root = path.join(directory, 'node_modules', 'bn.js');
  const resource = path.join(root, 'lib', 'bn.js');
  fs.mkdirSync(path.dirname(resource), { recursive: true });
  const metadata = JSON.parse(
    fs.readFileSync(path.resolve(path.dirname(bn4), '../package.json'), 'utf8')
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      ...metadata,
      browser: { buffer: require.resolve('buffer/') },
    })
  );
  fs.copyFileSync(bn4, resource);
  const { resources, result, dependencies } = await compile(`
    import OriginalBN from ${JSON.stringify(bn4)};
    import ChangedBN from ${JSON.stringify(resource)};
    export default {
      separate: OriginalBN !== ChangedBN,
      bufferHex: new ChangedBN('ff', 16).toBuffer('be').toString('hex'),
    };`);
  expect(resources).toEqual(expect.arrayContaining([bn4, resource]));
  expect(result).toEqual({ separate: true, bufferHex: 'ff' });
  expect(
    dependencies.find(
      (dependency) =>
        dependency.from === resource && dependency.request === 'buffer'
    )?.resource
  ).toBe(require.resolve('buffer/'));
});

it('preserves deterministic elliptic secp256k1 signing, verification and recovery', async () => {
  const source = `
    import elliptic from ${JSON.stringify(installed('elliptic'))};
    const curve = new elliptic.ec('secp256k1');
    const key = curve.keyFromPrivate('01', 'hex');
    const digest = Array(32).fill(0x42);
    const signature = key.sign(digest, { canonical: true });
    export default {
      r: signature.r.toString('hex', 64),
      s: signature.s.toString('hex', 64),
      recovery: signature.recoveryParam,
      publicKey: key.getPublic().encode('hex', false),
      recovered: curve.recoverPubKey(digest, signature, signature.recoveryParam).encode('hex', false),
      verified: curve.verify(digest, signature, key.getPublic()),
      wrongDigestVerified: curve.verify(Array(32).fill(0x43), signature, key.getPublic()),
    };`;
  const baseline = await compile(source, false);
  const deduplicated = await compile(source);
  expect(baseline.resources).toContain(installed('bn.js', 'elliptic'));
  expect(deduplicated.resources).not.toContain(installed('bn.js', 'elliptic'));
  expect(deduplicated.resources).toContain(bn4);
  const generator =
    '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' +
    '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
  expect(deduplicated.result).toEqual(baseline.result);
  expect(deduplicated.result).toEqual({
    r: '91c5bd51ba175134ee4a6634a93c2f5cc3ae8fc9bac3c98b896055bf0e5cf71c',
    s: '44f3bb8f35cd8e2704c3630ab1a3a92475502316d25cb8c166d77bdad9f3a6c9',
    recovery: 1,
    publicKey: generator,
    recovered: generator,
    verified: true,
    wrongDigestVerified: false,
  });
});

it('shares only identical decoder copies with equivalent buffer dependencies', async () => {
  const decoder = (anchor: string) =>
    path.join(
      path.dirname(installed('string_decoder/package.json', anchor)),
      'lib/string_decoder.js'
    );
  const a = decoder('browserify-sign');
  const b = decoder('hash-base');
  const { resources, result } = await compile(`
    import * as a from ${JSON.stringify(a)};
    import * as b from ${JSON.stringify(b)};
    import { Buffer } from ${JSON.stringify(require.resolve('buffer/'))};
    const decoder = new a.StringDecoder('utf8');
    export default {
      shared: a.StringDecoder === b.StringDecoder,
      prefix: decoder.write(Buffer.from([0xe2, 0x82])),
      suffix: decoder.end(Buffer.from([0xac])),
    };`);
  expect(resources).toContain(a);
  expect(resources).not.toContain(b);
  expect(result).toEqual({ shared: true, prefix: '', suffix: '€' });

  const root = path.join(directory, 'node_modules', 'string_decoder');
  const file = path.join(root, 'lib', 'string_decoder.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(a, file);
  fs.copyFileSync(
    path.join(path.dirname(a), '../package.json'),
    path.join(root, 'package.json')
  );
  const safe = path.join(root, 'node_modules', 'safe-buffer');
  fs.mkdirSync(safe, { recursive: true });
  fs.writeFileSync(
    path.join(safe, 'package.json'),
    JSON.stringify({ name: 'safe-buffer', version: '5.1.2', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(safe, 'index.js'),
    'exports.Buffer = require("buffer").Buffer; // changed\n'
  );
  const separate = await compile(`
    import * as a from ${JSON.stringify(a)};
    import * as b from ${JSON.stringify(file)};
    export default { separate: a.StringDecoder !== b.StringDecoder };`);
  expect(separate.resources).toEqual(expect.arrayContaining([a, file]));
  expect(separate.result).toEqual({ separate: true });
});

it('shares matching varuint copies and keeps the previous version separate', async () => {
  const a = installed('varuint-bitcoin', 'bip174');
  const b = installed('varuint-bitcoin', 'bitcoinjs-lib');
  const previous = installed('varuint-bitcoin', 'bip32');
  const { resources, result } = await compile(`
    import * as a from ${JSON.stringify(a)};
    import * as b from ${JSON.stringify(b)};
    import * as previous from ${JSON.stringify(previous)};
    export default {
      shared: a.encode === b.encode,
      separate: a.encode !== previous.encode,
      roundTrip: b.decode(a.encode(1000).buffer).numberValue,
    };`);
  expect(resources).toEqual(expect.arrayContaining([a, previous]));
  expect(resources).not.toContain(b);
  expect(result).toEqual({ shared: true, separate: true, roundTrip: 1000 });
});

it('shares equivalent safe-buffer copies without merging other versions', async () => {
  const a = installed('safe-buffer', 'level-iterator-stream');
  const b = installed('safe-buffer', 'level-ws');
  const newer = installed('safe-buffer');
  const baseline = await compile(
    `
    import * as a from ${JSON.stringify(a)};
    import * as b from ${JSON.stringify(b)};
    import * as newer from ${JSON.stringify(newer)};
    export default {
      same: a === b,
      separate: a !== newer,
      hex: a.Buffer.from('sample').toString('hex'),
    };`,
    false
  );
  const deduplicated = await compile(`
    import * as a from ${JSON.stringify(a)};
    import * as b from ${JSON.stringify(b)};
    import * as newer from ${JSON.stringify(newer)};
    export default {
      same: a === b,
      separate: a !== newer,
      hex: a.Buffer.from('sample').toString('hex'),
    };`);
  expect(baseline.resources).toEqual(expect.arrayContaining([a, b, newer]));
  expect(deduplicated.resources).toContain(a);
  expect(deduplicated.resources).not.toContain(b);
  expect(deduplicated.resources).toContain(newer);
  // Both versions expose the same underlying Buffer object; module paths
  // above prove that the different version remains in the compilation.
  expect(baseline.result).toEqual({
    same: true,
    separate: false,
    hex: '73616d706c65',
  });
  expect(deduplicated.result).toEqual(baseline.result);

  const root = path.join(directory, 'node_modules', 'safe-buffer');
  fs.mkdirSync(root, { recursive: true });
  const copy = path.join(root, 'index.js');
  fs.copyFileSync(a, copy);
  fs.copyFileSync(
    path.join(path.dirname(a), 'package.json'),
    path.join(root, 'package.json')
  );
  const bufferRoot = path.join(root, 'node_modules', 'buffer');
  fs.mkdirSync(bufferRoot, { recursive: true });
  fs.writeFileSync(
    path.join(bufferRoot, 'package.json'),
    JSON.stringify({ name: 'buffer', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(bufferRoot, 'index.js'),
    `module.exports = require(${JSON.stringify(require.resolve('buffer/'))});`
  );
  const differentResolution = await compile(`
    import * as a from ${JSON.stringify(a)};
    import * as copy from ${JSON.stringify(copy)};
    export default { hex: copy.Buffer.from('sample').toString('hex') };`);
  expect(differentResolution.resources).toEqual(
    expect.arrayContaining([a, copy])
  );
  expect(differentResolution.result).toEqual({ hex: '73616d706c65' });
});

it('keeps identical varuint source separate when its byte tools resolve differently', async () => {
  const original = installed('varuint-bitcoin', 'bip174');
  const sourceRoot = path.resolve(path.dirname(original), '../..');
  const root = path.join(directory, 'node_modules', 'varuint-bitcoin');
  const copy = path.join(root, 'src/cjs/index.cjs');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(original, copy);
  fs.copyFileSync(
    path.join(sourceRoot, 'package.json'),
    path.join(root, 'package.json')
  );
  const toolsRoot = path.join(root, 'node_modules', 'uint8array-tools');
  fs.mkdirSync(toolsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(toolsRoot, 'package.json'),
    JSON.stringify({
      name: 'uint8array-tools',
      version: '0.0.10',
      main: 'index.cjs',
    })
  );
  fs.writeFileSync(
    path.join(toolsRoot, 'index.cjs'),
    `module.exports = require(${JSON.stringify(
      installed('uint8array-tools', 'bip174')
    )});`
  );
  const { resources, result } = await compile(`
    import * as original from ${JSON.stringify(original)};
    import * as copy from ${JSON.stringify(copy)};
    export default {
      separate: original.encode !== copy.encode,
      roundTrip: copy.decode(copy.encode(1000).buffer).numberValue,
    };`);
  expect(resources).toEqual(expect.arrayContaining([original, copy]));
  expect(result).toEqual({ separate: true, roundTrip: 1000 });
});

it('preserves browserified readable stream decoding across the deduplication', async () => {
  const streams = ['browserify-sign', 'hash-base'].map((anchor) =>
    installed('readable-stream', anchor)
  );
  const source = `
    import streamA from ${JSON.stringify(streams[0])};
    import streamB from ${JSON.stringify(streams[1])};
    import { Buffer } from ${JSON.stringify(require.resolve('buffer/'))};
    function read(Stream) {
      const stream = new Stream.PassThrough();
      let text = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { text += chunk; });
      stream.write(Buffer.from([0x41, 0xe2, 0x82]));
      stream.end(Buffer.from([0xac, 0x42]));
      return text;
    }
    export default { first: read(streamA), second: read(streamB) };`;
  const baseline = await compile(source, false);
  const deduplicated = await compile(source);
  expect(baseline.result).toEqual({ first: 'A€B', second: 'A€B' });
  expect(deduplicated.result).toEqual(baseline.result);
});
