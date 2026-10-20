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
    version: '0.0.9',
    anchor: 'bip174',
    file: 'src/mjs/browser.js',
    match:
      /[\\/]node_modules[\\/]uint8array-tools[\\/]src[\\/]mjs[\\/]browser\.js$/,
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
    const entry = require.resolve(dependency.name, { paths: [anchor] });
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
          !original.bytes.equals(target.bytes)
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
