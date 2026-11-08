// Temporary adoption of reviewed public disposal APIs from Core #7391 and Utils #283.
// Remove this file and its manifest after adopting the corresponding official releases.
/* eslint-disable @typescript-eslint/no-var-requires -- This install script runs directly in Node CommonJS. */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');

const manifest = require('./walletconnect-terminal.json');
const manifestFile = path.join(__dirname, 'walletconnect-terminal.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = `core.${manifest.coreSource}.utils.${
  manifest.utilsSource
}.sha256.${digest(fs.readFileSync(manifestFile))}`;

function inspectPackages(mobileRoot, applying) {
  const updates = [];
  for (const pkg of manifest.packages) {
    const directory = path.join(mobileRoot, 'node_modules', pkg.name);
    const metadata = JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
    );
    if (metadata.name !== pkg.name || metadata.version !== pkg.version)
      throw Error(
        `WalletConnect terminal patch requires ${pkg.name}@${pkg.version}`
      );
    for (const file of pkg.files) {
      const target = path.join(directory, file.path);
      const actual = fs.existsSync(target)
        ? digest(fs.readFileSync(target))
        : null;
      if (actual === file.after) continue;
      if (!applying || actual !== file.before)
        throw Error(
          `WalletConnect terminal patch refused unexpected bytes in ${pkg.name}/${file.path}`
        );
      const output = inflateRawSync(Buffer.from(file.deflate, 'base64'), {
        maxOutputLength: file.bytes,
      });
      if (output.length !== file.bytes || digest(output) !== file.after)
        throw Error(
          `Invalid reviewed WalletConnect artifact ${pkg.name}/${file.path}`
        );
      updates.push({ target, output });
    }
  }
  return updates;
}

function applyWalletConnectTerminalPatch(mobileRoot) {
  // Check every affected package before changing any file. Interrupted updates
  // accept only original or already-reviewed bytes when retried.
  const updates = inspectPackages(mobileRoot, true);
  for (const { target, output } of updates) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.pali-terminal-${process.pid}`;
    try {
      fs.writeFileSync(temporary, output);
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}

function verifyWalletConnectTerminalPatch(mobileRoot) {
  inspectPackages(mobileRoot, false);
  return identity;
}

module.exports = {
  applyWalletConnectTerminalPatch,
  verifyWalletConnectTerminalPatch,
  identity,
};
if (require.main === module) {
  const mobileRoot = path.resolve(__dirname, '../apps/mobile');
  applyWalletConnectTerminalPatch(mobileRoot);
  console.log(`Applied reviewed WalletConnect terminal APIs ${identity}`);
}
