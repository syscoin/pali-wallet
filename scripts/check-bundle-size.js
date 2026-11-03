#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
// Run against an unpacked production ZIP: node scripts/check-bundle-size.js <directory>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const directory = path.resolve(process.argv[2] || 'build/chrome');
const budget = {
  app: 1600000,
  external: 1600000,
  // Sentry custody/review adds under 100 KB over 4,288,463-byte baseline startup.
  // Count every mandatory MV3 warm chunk below, including the optional feature.
  background: 4400000,
  contentScript: 16000,
  // The isolated device page loads only when a Ledger operation is requested.
  ledgerHost: 3100000,
  // Retain the shared-favicon and unused NFT-placeholder copy savings.
  // Keep a rounded, small-buffer ceiling below its package allowance;
  // CI measures the actual shipped artifact. Startup budgets stay unchanged.
  // Explicit privacy-transaction allowance: packaged circuit metadata, local
  // prover/WASM, license notices, and the deposit/withdrawal UI. Shared helpers
  // retain the deduplication savings; startup caps remain unchanged. The
  // measured unpacked production ZIP is about 9.331 MB, with a small buffer.
  // Encrypted whole-note files add 35,425 measured packaged bytes for the
  // codec, bounded orchestration and registered extension adapter. Allow 40 KB for
  // that reviewed feature; app/external/background startup caps stay unchanged.
  // The lazy export/restore dialog and its nine translated catalogs add about
  // 39 KB more. Allow another 40 KB of packaged files; startup caps remain fixed.
  // Finalized failed-withdrawal recovery adds about 22 KB for receipt/root
  // verification, retained history, consent UI and translations. Allow 30 KB
  // for that feature only; all startup ceilings above remain unchanged.
  // Connect 10 plus the reviewed lifecycle adapter adds under 200 KB after
  // removing the legacy UTXO helper graph. Startup caps remain unchanged.
  // DMK's isolated ESM host adds device/signing code. After byte-identical BN
  // deduplication and page-only translations, the composed package is 12.05 MB.
  // Keep normal wallet startup caps fixed and allow 12.15 MB for this feature.
  package: 12150000,
};
const allFiles = (root) =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? allFiles(file) : [file];
  });
const size = (files) =>
  [...new Set(files)].reduce((sum, file) => sum + fs.statSync(file).size, 0);
const pageScripts = (name) => {
  const html = fs.readFileSync(path.join(directory, `${name}.html`), 'utf8');
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']?([^\s"'>]+)/g)].map(
    ([, source]) => path.join(directory, source.split('?')[0])
  );
};
const scripts = {
  app: pageScripts('app'),
  external: pageScripts('external'),
  background: [
    path.join(directory, 'js/background.bundle.js'),
    // This packaged recovery chunk is preloaded when the worker evaluates.
    // Include it in startup cost, even though webpack emits a separate file.
    ...[
      'js/trezor-connect.bundle.js',
      'js/wallet-recovery.bundle.js',
      'js/private-vault.bundle.js',
      'js/note-backup.bundle.js',
      'js/privacy-transactions.bundle.js',
      'js/privacy-withdrawals.bundle.js',
      'js/privacy-relayers.bundle.js',
      'js/privacy-withdrawal.bundle.js',
      'js/privacy-prover.bundle.js',
      'js/privacy-background-shared.bundle.js',
      'js/sentry-controller.bundle.js',
      'js/sentry-sdk.bundle.js',
      // Required by the Sentry SDK's evaluation-time preload when present.
      'js/sentry-crypto-shared.bundle.js',
      'js/sentry-wallet-authority.bundle.js',
    ]
      .map((file) => path.join(directory, file))
      .filter((file) => fs.existsSync(file)),
  ],
  contentScript: [path.join(directory, 'js/contentScript.bundle.js')],
};
if (fs.existsSync(path.join(directory, 'ledger.html')))
  scripts.ledgerHost = pageScripts('ledger');
const report = Object.fromEntries(
  Object.entries(scripts).map(([name, files]) => [
    name,
    {
      bytes: size(files),
      gzipBytes: files.reduce(
        (sum, file) => sum + zlib.gzipSync(fs.readFileSync(file)).length,
        0
      ),
      budgetBytes: budget[name],
    },
  ])
);
report.package = {
  bytes: size(allFiles(directory)),
  budgetBytes: budget.package,
};
console.log(JSON.stringify(report, null, 2));
const exceeded = Object.entries(report).filter(
  ([, value]) => value.bytes > value.budgetBytes
);
if (exceeded.length) {
  console.error(
    `Bundle budgets exceeded: ${exceeded.map(([name]) => name).join(', ')}`
  );
  process.exitCode = 1;
}
