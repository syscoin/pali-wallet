const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { spawnSync } = require('node:child_process');
const {
  PRIVACY_PROVING_KEY_URL,
  PRIVACY_PROVING_KEY_BYTES,
  PRIVACY_PROVING_KEY_SHA256,
} = require('../source/utils/privacy/proverArtifacts.ts');

async function downloadProvingKey(fetcher) {
  const response = await fetcher(PRIVACY_PROVING_KEY_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok || !response.body)
    throw Error('PRIVATE_PROOF_KEY_DOWNLOAD_FAILED');
  const reader = response.body.getReader();
  const bytes = Buffer.alloc(PRIVACY_PROVING_KEY_BYTES);
  let count = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      if (count + item.value.byteLength > bytes.length)
        throw Error('PRIVATE_PROOF_KEY_INVALID');
      bytes.set(item.value, count);
      count += item.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (
    count !== PRIVACY_PROVING_KEY_BYTES ||
    crypto.createHash('sha256').update(bytes).digest('hex') !==
      PRIVACY_PROVING_KEY_SHA256
  )
    throw Error('PRIVATE_PROOF_KEY_INVALID');
  return bytes;
}

async function main() {
  const app = process.argv.length === 3 && process.argv[2] === '--app';
  if (
    !app &&
    (process.argv.length !== 2 ||
      process.env.CI !== 'true' ||
      process.env.PALI_NATIVE_PRIVATE_PROOF_QUALIFICATION !== '1' ||
      !process.env.RUNNER_TEMP)
  )
    throw Error('PRIVATE_PROOF_PACKAGING_REQUIRES_ISOLATED_CI');
  const root = path.resolve(__dirname, '..');
  require('./apply-keyring-ledger.cjs').verifyKeyringLedgerPatch(
    path.join(root, 'node_modules/@sidhujag/sysweb3-keyring')
  );
  const directory = app
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'pali-private-proof-'))
    : process.env.RUNNER_TEMP;
  let key;
  try {
    key = await downloadProvingKey(fetch);
    const file = path.join(directory, 'pali-private-proof-key.bin');
    fs.writeFileSync(file, key, { flag: 'wx' });
    fs.writeFileSync(
      file + '.json',
      JSON.stringify({
        url: PRIVACY_PROVING_KEY_URL,
        bytes: key.length,
        sha256: PRIVACY_PROVING_KEY_SHA256,
      }) + '\n',
      { flag: 'wx' }
    );
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'build-native-private-prover.cjs'), file],
      { stdio: 'inherit', timeout: 120000 }
    );
    if (result.status !== 0) throw Error('PRIVATE_PROOF_PACKAGING_FAILED');
  } finally {
    key?.fill(0);
    if (app) fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { downloadProvingKey, main };
