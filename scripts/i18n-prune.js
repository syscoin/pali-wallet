/* Prune unused translation keys (list from i18n-analyze.js) and rebuild all
 * locales using en.json as the structural template (same keys, same order). */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'source', 'assets', 'locales');
const LANGS = ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];

const unusedFile = process.argv[2];
if (!unusedFile) {
  console.error('Usage: node i18n-prune.js <file-with-unused-keys>');
  process.exit(1);
}
const unused = new Set(
  fs
    .readFileSync(unusedFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
);

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function prune(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const child = prune(v, key);
      if (Object.keys(child).length > 0) out[k] = child;
    } else if (!unused.has(key)) {
      out[k] = v;
    }
  }
  return out;
}

// Rebuild `template` structure using values from `flatLang` (fallback to template value).
function rebuild(template, flatLang, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(template)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = rebuild(v, flatLang, key);
    } else {
      out[k] = key in flatLang ? flatLang[key] : v;
    }
  }
  return out;
}

const en = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8')
);
const enPruned = prune(en);
const before = Object.keys(flatten(en)).length;
const after = Object.keys(flatten(enPruned)).length;
console.log(`en: ${before} -> ${after} keys (removed ${before - after})`);

for (const lng of LANGS) {
  const file = path.join(LOCALES_DIR, `${lng}.json`);
  let result;
  if (lng === 'en') {
    result = enPruned;
  } else {
    const flatLang = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
    const missing = Object.keys(flatten(enPruned)).filter(
      (k) => !(k in flatLang)
    );
    if (missing.length)
      console.log(`${lng}: filled from EN: ${missing.join(', ')}`);
    result = rebuild(enPruned, flatLang);
  }
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(`${lng}: written (${Object.keys(flatten(result)).length} keys)`);
}
