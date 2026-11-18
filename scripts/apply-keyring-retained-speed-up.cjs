// Temporary adoption of Sysweb3 #121 while the SDK PR is open for review.
/* eslint-disable @typescript-eslint/no-var-requires */
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');

const manifestPath = path.join(__dirname, 'keyring-retained-speed-up.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const name = '@sidhujag/sysweb3-keyring';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = `retained-speed-up.${manifest.source}.${hash(fs.readFileSync(manifestPath))}`;

function localFile(root, relative) {
  const target = path.join(root, relative);
  if (fs.realpathSync(target) !== target || !fs.lstatSync(target).isFile())
    throw Error(`Keyring Speed Up patch requires a local file: ${relative}`);
  return target;
}

function applyEdits(bytes, edits) {
  const parts = [];
  let previous = 0;
  for (const [start, end, replacement] of edits) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < previous || end < start || end > bytes.length)
      throw Error('Invalid Keyring Speed Up patch range');
    parts.push(bytes.subarray(previous, start), Buffer.from(replacement));
    previous = end;
  }
  return Buffer.concat([...parts, bytes.subarray(previous)]);
}

function inspect(directory, applying) {
  const root = fs.realpathSync(directory);
  const application = JSON.parse(fs.readFileSync(localFile(root, 'package.json')));
  const prefix = `node_modules/${name}`;
  const metadataFile = localFile(root, `${prefix}/package.json`);
  const installed = JSON.parse(fs.readFileSync(metadataFile));
  if (application.dependencies?.[name] !== manifest.version ||
      installed.name !== name || installed.version !== manifest.version ||
      fs.realpathSync(require.resolve(`${name}/package.json`, { paths: [root] })) !== metadataFile)
    throw Error(`Keyring Speed Up patch requires local ${name}@${manifest.version}`);

  return manifest.files.flatMap(file => {
    if (!/^(?:cjs|esm|types)\/[a-zA-Z0-9_.\/-]+$/.test(file.path) ||
        file.path.split('/').some(part => part === '.' || part === '..'))
      throw Error('Invalid Keyring Speed Up patch path');
    const target = localFile(root, `${prefix}/${file.path}`);
    const bytes = fs.readFileSync(target), sha = hash(bytes);
    if (sha === file.after) return [];
    if (!applying || sha !== file.before)
      throw Error(`Keyring Speed Up patch refused unexpected bytes in ${file.path}`);
    const output = file.compressed
      ? inflateSync(Buffer.from(file.compressed, 'base64'), { maxOutputLength: file.bytes })
      : applyEdits(bytes, file.edits);
    if (output.length !== file.bytes || hash(output) !== file.after)
      throw Error(`Keyring Speed Up patch output mismatch in ${file.path}`);
    return [{ target, output }];
  });
}

function applyKeyringSpeedUpPatch(directory) {
  const updates = inspect(directory, true);
  for (const { target, output } of updates) {
    const temporary = `${target}.pali-speed-up-${randomUUID()}`;
    fs.writeFileSync(temporary, output, { flag: 'wx', mode: 0o644 });
    try { fs.renameSync(temporary, target); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
}

function verifyKeyringSpeedUpPatch(directory) {
  inspect(directory, false);
  return identity;
}

module.exports = { applyKeyringSpeedUpPatch, verifyKeyringSpeedUpPatch };
if (require.main === module) applyKeyringSpeedUpPatch(process.cwd());
