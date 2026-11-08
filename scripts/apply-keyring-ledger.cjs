// Temporary PR #95 adoption. Remove this script and manifest with the SDK release.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('./keyring-ledger-2.1.7.json');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function applyKeyringLedgerPatch(packageRoot) {
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.name !== manifest.package || metadata.version !== manifest.version)
    throw new Error('Ledger patch requires the exact reviewed keyring 2.1.7 package');
  // Validate the entire package boundary before replacing any file. A retried
  // installation can contain any mix of original and already-patched bytes.
  const replacements = manifest.files.flatMap((file) => {
    const target = path.join(packageRoot, file.path);
    const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const actual = original === null ? null : digest(original);
    if (actual === file.after) return [];
    if (actual !== file.before)
      throw new Error(`Ledger patch refused unexpected package bytes in ${file.path}`);
    const input = original ?? Buffer.alloc(0);
    const parts = [];
    let cursor = 0;
    for (const edit of file.edits) {
      if (!Number.isSafeInteger(edit.offset) || !Number.isSafeInteger(edit.remove) ||
          edit.offset < cursor || edit.remove < 0 || edit.offset + edit.remove > input.length)
        throw new Error(`Invalid reviewed Ledger patch for ${file.path}`);
      parts.push(input.subarray(cursor, edit.offset), Buffer.from(edit.insert, 'base64'));
      cursor = edit.offset + edit.remove;
    }
    parts.push(input.subarray(cursor));
    const output = Buffer.concat(parts);
    if (digest(output) !== file.after)
      throw new Error(`Ledger patch output mismatch in ${file.path}`);
    return [{ target, output }];
  });
  for (const { target, output } of replacements) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.pali-ledger-${process.pid}`;
    try {
      fs.writeFileSync(temporary, output);
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}

function verifyKeyringLedgerPatch(packageRoot) {
  for (const file of manifest.files) {
    const target = path.join(packageRoot, file.path);
    if (!fs.existsSync(target) || digest(fs.readFileSync(target)) !== file.after)
      throw new Error(`Reviewed Ledger SDK patch is missing or changed in ${file.path}`);
  }
}

module.exports = { applyKeyringLedgerPatch, verifyKeyringLedgerPatch };
if (require.main === module) {
  const packageFile = require.resolve('@sidhujag/sysweb3-keyring/package.json', { paths: [process.cwd()] });
  applyKeyringLedgerPatch(path.dirname(packageFile));
  console.log(`Applied reviewed Ledger SDK patch ${manifest.sourceCommit.slice(0, 8)}`);
}
