// Temporary adoption of the reviewed exact fee conversion from Sysweb3 #110.
// Remove this file and its manifest after adopting the official keyring release.
/* eslint-disable @typescript-eslint/no-var-requires -- This install script runs directly in Node CommonJS. */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('./keyring-fee-rate.json');
const manifestFile = path.join(__dirname, 'keyring-fee-rate.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = `keyring.${manifest.source}.sha256.${digest(
  fs.readFileSync(manifestFile)
)}`;

// Installation packages must belong to this checkout. Following a linked
// node_modules, package directory or output file could mutate another worktree.
function localTarget(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Dependency patch target escapes its installation');
  let current = fs.realpathSync(root);
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error('Dependency patch refuses linked installation targets');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

function inspectPackages(mobileRoot, applying) {
  mobileRoot = fs.realpathSync(mobileRoot);
  const updates = [];
  for (const pkg of manifest.packages) {
    const directory = localTarget(
      mobileRoot,
      path.join(mobileRoot, 'node_modules', pkg.name)
    );
    const metadata = JSON.parse(
      fs.readFileSync(
        localTarget(mobileRoot, path.join(directory, 'package.json')),
        'utf8'
      )
    );
    if (metadata.name !== pkg.name || metadata.version !== pkg.version)
      throw Error(`Keyring fee-rate patch requires ${pkg.name}@${pkg.version}`);
    for (const file of pkg.files) {
      const target = localTarget(mobileRoot, path.join(directory, file.path));
      const actual = fs.existsSync(target)
        ? digest(fs.readFileSync(target))
        : null;
      if (actual === file.after) continue;
      if (!applying || actual !== file.before)
        throw Error(
          `Keyring fee-rate patch refused unexpected bytes in ${pkg.name}/${file.path}`
        );
      let text = file.text;
      if (file.edits) {
        text = fs.readFileSync(target, 'utf8');
        for (const edit of file.edits) {
          if (text.split(edit.before).length !== 2)
            throw Error(
              `Keyring fee-rate patch requires one exact edit in ${file.path}`
            );
          text = text.replace(edit.before, () => edit.after);
        }
      }
      const output = Buffer.from(text, 'utf8');
      if (output.length !== file.bytes || digest(output) !== file.after)
        throw Error(
          `Invalid reviewed KeyringFeeRate artifact ${pkg.name}/${file.path}`
        );
      updates.push({ target, output });
    }
  }
  return updates;
}

function applyKeyringFeeRatePatch(mobileRoot) {
  // Check every affected package before changing any file. Interrupted updates
  // accept only original or already-reviewed bytes when retried.
  const updates = inspectPackages(mobileRoot, true);
  for (const { target, output } of updates) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.pali-fee-rate-${process.pid}`;
    let created = false;
    try {
      fs.writeFileSync(temporary, output, { flag: 'wx', mode: 0o600 });
      created = true;
      fs.renameSync(temporary, target);
    } finally {
      if (created) fs.rmSync(temporary, { force: true });
    }
  }
}

function verifyKeyringFeeRatePatch(mobileRoot) {
  inspectPackages(mobileRoot, false);
  return identity;
}

module.exports = {
  applyKeyringFeeRatePatch,
  verifyKeyringFeeRatePatch,
  identity,
};
if (require.main === module) {
  const mobileRoot = process.cwd();
  applyKeyringFeeRatePatch(mobileRoot);
  console.log(`Applied reviewed keyring fee conversion ${identity}`);
}
