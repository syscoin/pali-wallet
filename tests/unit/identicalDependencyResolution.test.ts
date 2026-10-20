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
const bytes9 = byteFile('bip174');
const bytes8 = byteFile();
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

it('deduplicates the installed identical versions while preserving BN5 and older byte tools', async () => {
  const paths = bnAnchors.map((anchor) => installed('bn.js', anchor));
  const source = `
    ${paths
      .map(
        (resource, index) =>
          `import BN${index} from ${JSON.stringify(resource)};`
      )
      .join('\n')}
    import RootBN5 from ${JSON.stringify(bn5)};
    import * as a from ${JSON.stringify(bytes9)};
    import * as b from ${JSON.stringify(byteFile('bitcoinjs-lib'))};
    import * as old from ${JSON.stringify(bytes8)};
    const constructors = [${paths.map((_, index) => `BN${index}`).join(',')}];
    const value = new BN0('ffffffffffffffff', 16);
    const buffer = new Uint8Array(12);
    a.writeUInt32(buffer, 0, 0x89abcdef, 'LE');
    b.writeUInt64(buffer, 4, 0x0102030405060708n, 'BE');
    export default {
      sameBn4: constructors.every(BN => BN === BN0),
      separateBn5: RootBN5 !== BN0,
      sameBytes9: a === b,
      separateBytes8: old.toHex !== a.toHex,
      product: value.mul(new constructors[8](2)).toString(16),
      bnBytes: Array.from(value.toArrayLike(Uint8Array, 'be', 8)),
      bn5Sum: new RootBN5('9007199254740993').addn(1).toString(),
      bytes: a.toHex(buffer),
      uint32: b.readUInt32(buffer, 0, 'LE'),
      uint64: a.readUInt64(buffer, 4, 'BE').toString(),
      olderRoundTrip: old.toHex(old.fromHex('00aabbff')),
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
    [bytes9, bytes8].sort()
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
        [bytes9, byteFile('bitcoinjs-lib')].includes(dependency.from)
      )
    ).toEqual([]);
  }
  expect(deduplicated.packageMetadata).toEqual(
    expect.arrayContaining([
      { resource: bn4, root: path.resolve(path.dirname(bn4), '..') },
      {
        resource: bytes9,
        root: path.resolve(path.dirname(bytes9), '../..'),
      },
    ])
  );
  expect(baseline.result).toMatchObject({ sameBn4: false, sameBytes9: false });
  expect(deduplicated.result).toEqual({
    sameBn4: true,
    separateBn5: true,
    sameBytes9: true,
    separateBytes8: true,
    product: '1fffffffffffffffe',
    bnBytes: Array(8).fill(255),
    bn5Sum: '9007199254740994',
    bytes: 'efcdab890102030405060708',
    uint32: 0x89abcdef,
    uint64: '72623859790382856',
    olderRoundTrip: '00aabbff',
  });
  expect(baseline.result).toEqual({
    ...deduplicated.result,
    sameBn4: false,
    sameBytes9: false,
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
    version: '0.0.9',
    otherVersion: '0.0.8',
    file: 'src/mjs/browser.js',
    canonical: bytes9,
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
