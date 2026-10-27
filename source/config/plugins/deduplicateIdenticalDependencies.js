/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { NormalModuleReplacementPlugin } = require('webpack');

const dependencies = [
  {
    name: 'bn.js',
    version: '4.12.4',
    anchor: 'asn1.js',
    file: 'lib/bn.js',
    browserBufferIgnored: true,
    match: /[\\/]node_modules[\\/]bn\.js[\\/]lib[\\/]bn\.js$/,
  },
  {
    name: 'uint8array-tools',
    version: '0.0.8',
    anchor: 'bip32',
    file: 'src/mjs/browser.js',
    match:
      /[\\/]node_modules[\\/]uint8array-tools[\\/]src[\\/]mjs[\\/]browser\.js$/,
  },
  {
    name: 'string_decoder',
    version: '1.1.1',
    anchor: 'browserify-sign',
    packageJsonEntry: true,
    file: 'lib/string_decoder.js',
    match:
      /[\\/]node_modules[\\/]string_decoder[\\/]lib[\\/]string_decoder\.js$/,
    compareDependencies: 'decoder',
  },
  {
    name: 'safe-buffer',
    version: '5.1.2',
    anchor: 'level-iterator-stream',
    file: 'index.js',
    match: /[\\/]node_modules[\\/]safe-buffer[\\/]index\.js$/,
    compareDependencies: 'buffer',
  },
  {
    name: 'varuint-bitcoin',
    version: '2.0.1',
    anchor: 'bip174',
    file: 'src/cjs/index.cjs',
    match:
      /[\\/]node_modules[\\/]varuint-bitcoin[\\/]src[\\/]cjs[\\/]index\.cjs$/,
    compareDependencies: 'varuint',
  },
];

function readResource(resource, dependency) {
  if (!dependency.match.test(resource)) return;
  try {
    const root = path.resolve(resource.slice(0, -dependency.file.length));
    const metadata = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    if (
      metadata.name !== dependency.name ||
      metadata.version !== dependency.version ||
      (dependency.browserBufferIgnored && metadata.browser?.buffer !== false)
    )
      return;
    return { bytes: fs.readFileSync(resource), metadata, root };
  } catch {
    // Unknown, changed or unreadable packages keep their original resolution.
    return;
  }
}

function canonicalResource(dependency) {
  try {
    const anchor = path.dirname(require.resolve(dependency.anchor));
    const entry = require.resolve(
      dependency.packageJsonEntry
        ? `${dependency.name}/package.json`
        : dependency.name,
      { paths: [anchor] }
    );
    let root = path.dirname(entry);
    while (path.dirname(root) !== root) {
      const resource = path.join(root, dependency.file);
      if (readResource(resource, dependency)) return resource;
      root = path.dirname(root);
    }
  } catch {
    // A missing or upgraded pinned dependency disables only its own dedup.
  }
}

// Changing module identity also changes where relative dependencies resolve.
// Only canonicalize these modules when their dependencies remain equivalent.
function equivalentDependencies(original, target, dependency) {
  try {
    if (dependency.compareDependencies === 'buffer') {
      return (
        require.resolve('buffer/', { paths: [original.root] }) ===
        require.resolve('buffer/', { paths: [target.root] })
      );
    }
    if (dependency.compareDependencies === 'varuint') {
      return (
        require.resolve('uint8array-tools', { paths: [original.root] }) ===
        require.resolve('uint8array-tools', { paths: [target.root] })
      );
    }
    if (dependency.compareDependencies === 'decoder') {
      const safe = (root) => {
        const file = require.resolve('safe-buffer', { paths: [root] });
        const dir = path.dirname(file);
        const metadata = JSON.parse(
          fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
        );
        if (metadata.name !== 'safe-buffer' || metadata.version !== '5.1.2')
          return;
        return {
          bytes: fs.readFileSync(file),
          browser: JSON.stringify(metadata.browser),
          buffer: require.resolve('buffer/', { paths: [dir] }),
        };
      };
      const a = safe(original.root);
      const b = safe(target.root);
      return Boolean(
        a &&
          b &&
          a.browser === b.browser &&
          a.buffer === b.buffer &&
          a.bytes.equals(b.bytes)
      );
    }
    return true;
  } catch {
    return false;
  }
}

/** Share only these pinned, identical single-file implementations in a build. */
function createIdenticalDependencyDedupPlugins() {
  return dependencies.flatMap((dependency) => {
    const canonical = canonicalResource(dependency);
    if (!canonical) return [];
    return [
      new NormalModuleReplacementPlugin(dependency.match, (resolution) => {
        const data = resolution.createData;
        // Operate after resolution; loaders, queries and virtual resources may
        // intentionally produce different modules from the same source file.
        if (!data || data.loaders?.length || data.matchResource) return;
        const original = readResource(data.resource, dependency);
        const target = readResource(canonical, dependency);
        if (
          !original ||
          !target ||
          original.metadata.type !== target.metadata.type ||
          JSON.stringify(original.metadata.browser) !==
            JSON.stringify(target.metadata.browser) ||
          !original.bytes.equals(target.bytes) ||
          !equivalentDependencies(original, target, dependency)
        )
          return;

        // Updating resource alone changes the bytes but leaves Webpack's old
        // module identifier. All three paths must name the canonical module.
        data.resource = canonical;
        data.request = canonical;
        data.userRequest = canonical;
        data.context = path.dirname(canonical);
        data.resourceResolveData = {
          ...data.resourceResolveData,
          path: canonical,
          relativePath: `./${dependency.file}`,
          descriptionFilePath: path.join(target.root, 'package.json'),
          descriptionFileRoot: target.root,
          descriptionFileData: target.metadata,
        };
      }),
    ];
  });
}

module.exports = { createIdenticalDependencyDedupPlugins };
