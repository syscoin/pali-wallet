// Temporary runtime adoption of the reviewed, unpublished Sysweb3 PR #119.
// Remove this overlay after the reviewed packages are published and adopted.
/* eslint-disable @typescript-eslint/no-var-requires */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');

const manifestFile = path.join(__dirname, 'sysweb3-overlay.json');
const manifestBytes = fs.readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = `sysweb3.${manifest.source.commit}.sha256.${digest(
  manifestBytes
)}`;

function localTarget(root, target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('SDK overlay target escapes its installation');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error('SDK overlay refuses linked installation targets');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function payload() {
  if (
    manifest.payload.file !== 'sysweb3-overlay.deflate' ||
    !Number.isSafeInteger(manifest.payload.bytes) ||
    manifest.payload.bytes < 1 ||
    manifest.payload.bytes > 2 * 1024 * 1024
  )
    throw Error('Invalid SDK overlay payload bound');
  const file = path.join(__dirname, manifest.payload.file);
  if (
    !Number.isSafeInteger(manifest.payload.compressedBytes) ||
    manifest.payload.compressedBytes < 1 ||
    manifest.payload.compressedBytes > 512 * 1024 ||
    fs.statSync(file).size !== manifest.payload.compressedBytes
  )
    throw Error('Invalid SDK overlay compressed size');
  const compressed = fs.readFileSync(file);
  if (digest(compressed) !== manifest.payload.sha256)
    throw Error('SDK overlay payload identity mismatch');
  const bytes = inflateRawSync(compressed, {
    maxOutputLength: manifest.payload.bytes,
  });
  if (
    bytes.length !== manifest.payload.bytes ||
    digest(bytes) !== manifest.payload.decodedSha256
  )
    throw Error('SDK overlay decoded identity mismatch');
  const result = JSON.parse(bytes.toString('utf8'));
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    Object.keys(result).length !== manifest.payload.files
  )
    throw Error('Invalid SDK overlay artifact inventory');
  return result;
}

function verifySdkEdges(root, application) {
  const consumers = new Set([
    ...manifest.packages.map((pkg) => pkg.name),
    ...Object.keys({
      ...application.dependencies,
      ...application.optionalDependencies,
    }).filter((name) => name.startsWith('@sidhujag/sysweb3-')),
  ]);
  for (const name of consumers) {
    const directory = fs.realpathSync(path.join(root, 'node_modules', name));
    const metadata = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
    );
    if (metadata.name !== name)
      throw Error(`SDK overlay refused invalid consumer ${name}`);
    const dependencies = {
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    };
    for (const dependency of manifest.packages) {
      if (!dependencies[dependency.name]) continue;
      const expected = localTarget(
        root,
        path.join(root, 'node_modules', dependency.name, 'package.json')
      );
      const resolved = require.resolve(`${dependency.name}/package.json`, {
        paths: [directory],
      });
      if (fs.realpathSync(resolved) !== expected)
        throw Error(
          `SDK overlay refused shadowed dependency ${dependency.name}`
        );
      // Webpack also searches this ancestor, which Node deliberately skips.
      // A linked development installation must not reintroduce pristine SDKs.
      const browserShadow = path.join(
        root,
        'node_modules',
        'node_modules',
        dependency.name,
        'package.json'
      );
      if (
        fs.existsSync(browserShadow) &&
        fs.realpathSync(browserShadow) !== expected
      )
        throw Error(
          `SDK overlay refused shadowed dependency ${dependency.name}`
        );
    }
  }
}

function inspect(root, applying) {
  root = fs.realpathSync(root);
  const application = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  if (application.paliSysweb3Overlay !== identity)
    throw Error('SDK overlay requires exact application provenance');
  const output = payload();
  verifySdkEdges(root, application);
  const updates = [];
  const orphaned = [];
  let changed = 0;
  for (const pkg of manifest.packages) {
    const directory = localTarget(
      root,
      path.join(root, 'node_modules', pkg.name)
    );
    const metadata = JSON.parse(
      fs.readFileSync(
        localTarget(root, path.join(directory, 'package.json')),
        'utf8'
      )
    );
    if (
      metadata.name !== pkg.name ||
      metadata.version !== pkg.version ||
      (application.dependencies?.[pkg.name] !== undefined &&
        application.dependencies[pkg.name] !== pkg.version)
    )
      throw Error(`SDK overlay requires ${pkg.name}@${pkg.version}`);
    const expected = new Map();
    for (const file of pkg.files) {
      if (
        !/^(?:package\.json|(?:cjs|esm|types)\/[A-Za-z0-9_./-]+)$/.test(
          file.path
        ) ||
        file.path.split('/').some((part) => part === '.' || part === '..') ||
        expected.has(file.path)
      )
        throw Error('Invalid SDK overlay artifact path');
      expected.set(file.path, file);
      const target = localTarget(root, path.join(directory, file.path));
      const size = fs.existsSync(target) ? fs.statSync(target).size : null;
      if (size !== file.beforeBytes && size !== file.bytes)
        throw Error(
          `SDK overlay refused unexpected bytes in ${pkg.name}/${file.path}`
        );
      const actual = size === null ? null : digest(fs.readFileSync(target));
      const key = `${pkg.name}/${file.path}`;
      let artifact;
      if (file.before !== file.after) {
        changed++;
        if (!Object.hasOwn(output, key) || typeof output[key] !== 'string')
          throw Error(`Missing SDK overlay artifact ${key}`);
        artifact = Buffer.from(output[key], 'utf8');
        if (artifact.length !== file.bytes || digest(artifact) !== file.after)
          throw Error(`Invalid SDK overlay artifact ${key}`);
      }
      if (actual === file.after) continue;
      if (!applying || actual !== file.before || !artifact)
        throw Error(`SDK overlay refused unexpected bytes in ${key}`);
      updates.push({ target, artifact });
    }
    const visit = (folder, prefix) => {
      if (!fs.existsSync(folder)) return;
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const relative = `${prefix}/${entry.name}`;
        const target = localTarget(root, path.join(directory, relative));
        if (entry.isDirectory()) visit(target, relative);
        else if (!entry.isFile() || !expected.has(relative)) {
          const original = relative.replace(/\.pali-sysweb3-\d+$/, '');
          const artifact = expected.get(original);
          if (
            entry.isFile() &&
            original !== relative &&
            artifact &&
            fs.statSync(target).size === artifact.bytes &&
            digest(fs.readFileSync(target)) === artifact.after
          )
            orphaned.push(target);
          else
            throw Error(
              `SDK overlay refused unexpected artifact ${pkg.name}/${relative}`
            );
        }
      }
    };
    for (const folder of ['cjs', 'esm', 'types'])
      visit(path.join(directory, folder), folder);
  }
  if (changed !== manifest.payload.files)
    throw Error('SDK overlay artifact inventory mismatch');
  if (!applying && orphaned.length)
    throw Error('Incomplete SDK overlay application');
  return { updates, orphaned };
}

function applySysweb3Overlay(root) {
  // Validate every package and payload before writing. An interrupted apply can
  // resume only from pristine package bytes or these exact reviewed outputs.
  const { updates, orphaned } = inspect(root, true);
  for (const file of orphaned) fs.rmSync(file);
  for (const { target, artifact } of updates) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.pali-sysweb3-${process.pid}`;
    let created = false;
    try {
      fs.writeFileSync(temporary, artifact, { flag: 'wx', mode: 0o644 });
      created = true;
      fs.renameSync(temporary, target);
    } finally {
      if (created) fs.rmSync(temporary, { force: true });
    }
  }
}

function verifySysweb3Overlay(root) {
  inspect(root, false);
  return identity;
}

module.exports = { applySysweb3Overlay, verifySysweb3Overlay, identity };
if (require.main === module) {
  const verifying = process.argv[2] === '--verify';
  const root = path.resolve(process.argv[verifying ? 3 : 2] ?? process.cwd());
  if (verifying) verifySysweb3Overlay(root);
  else applySysweb3Overlay(root);
  console.log(
    `${verifying ? 'Verified' : 'Applied'} reviewed SDK overlay ${identity}`
  );
}
