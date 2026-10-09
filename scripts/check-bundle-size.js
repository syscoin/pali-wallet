#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
// Run after a production build: node scripts/check-bundle-size.js [build/chrome]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const directory = path.resolve(process.argv[2] || 'build/chrome');
const budget = {
  app: 1600000,
  external: 1600000,
  background: 4300000,
  contentScript: 16000,
  package: 9000000,
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
  background: [path.join(directory, 'js/background.bundle.js')],
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
