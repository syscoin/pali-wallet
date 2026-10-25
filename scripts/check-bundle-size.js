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
  // Retain the shared-favicon and unused NFT-placeholder copy savings.
  // Keep a rounded, small-buffer ceiling below its package allowance;
  // CI measures the actual shipped artifact. Startup budgets stay unchanged.
  // Explicit new-feature allowance: public pool sync, local MiMC verification,
  // and nine-language preparation UI add about 38 KB over the 8,561,290-byte
  // shipped baseline. Preserve startup caps and a small rounded package buffer.
  package: 8605000,
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
      'js/wallet-recovery.bundle.js',
      'js/private-vault.bundle.js',
      'js/sentry-controller.bundle.js',
      'js/sentry-sdk.bundle.js',
      'js/sentry-wallet-authority.bundle.js',
    ]
      .map((file) => path.join(directory, file))
      .filter((file) => fs.existsSync(file)),
  ],
  contentScript: [path.join(directory, 'js/contentScript.bundle.js')],
};
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
