/* Analyze translation keys: find unused keys and cross-language inconsistencies. */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'source', 'assets', 'locales');
const LANGS = ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// --- Load locales ---
const locales = {};
for (const lng of LANGS) {
  locales[lng] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${lng}.json`), 'utf8')
  );
}
const enFlat = flatten(locales.en);
const enKeys = new Set(Object.keys(enFlat));

// --- Collect source files ---
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}
const files = walk(path.join(ROOT, 'source'));

// --- Extract string literals + template literal prefixes from source ---
const literals = new Set();
const dynamicPrefixes = new Set();
const translationCalls = new Map();

const strRe = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
// template literals with interpolation: capture static prefix before first ${
const tplRe = /`([^`$]*)\$\{[^`]*`/g;
// full template literals without interpolation
const tplPlainRe = /`([^`$\\]*)`/g;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = strRe.exec(src))) literals.add(m[2]);
  while ((m = tplPlainRe.exec(src))) literals.add(m[1]);
  while ((m = tplRe.exec(src))) {
    const prefix = m[1];
    if (/^[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]*$/.test(prefix))
      dynamicPrefixes.add(prefix);
  }

  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isTranslationCall =
        (ts.isIdentifier(callee) && callee.text === 't') ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'i18next' &&
          callee.name.text === 't');
      const [keyArg] = node.arguments;

      if (
        isTranslationCall &&
        keyArg &&
        ts.isStringLiteralLike(keyArg) &&
        /^[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.-]+$/.test(keyArg.text)
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          keyArg.getStart(sourceFile)
        );
        const locations = translationCalls.get(keyArg.text) || [];
        locations.push(
          `${path.relative(ROOT, file)}:${position.line + 1}:${
            position.character + 1
          }`
        );
        translationCalls.set(keyArg.text, locations);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

// --- Determine used keys ---
// `send.${tab.tabName.toLowerCase()}` in SendTransaction.tsx only resolves to
// the tab names defined in mockedTabs.ts (Details/Data/Hex), so don't treat
// the whole `send.` prefix as dynamic.
dynamicPrefixes.delete('send.');
['send.details', 'send.data', 'send.hex'].forEach((k) => literals.add(k));

const used = new Set();
const usedViaDynamic = new Set();
for (const key of enKeys) {
  if (literals.has(key)) {
    used.add(key);
    continue;
  }
  for (const p of dynamicPrefixes) {
    if (key.startsWith(p)) {
      used.add(key);
      usedViaDynamic.add(`${key}  (via \`${p}\${...}\`)`);
      break;
    }
  }
}
const unused = [...enKeys].filter((k) => !used.has(k)).sort();
const missingFromEn = [...translationCalls.entries()]
  .filter(([key]) => !enKeys.has(key))
  .sort(([a], [b]) => a.localeCompare(b));

console.log('=== Translation calls missing from en ===');
if (missingFromEn.length === 0) {
  console.log('none');
} else {
  for (const [key, locations] of missingFromEn) {
    console.log(`  MISSING ${key}`);
    for (const location of locations) console.log(`    ${location}`);
  }
}

// --- Cross-language consistency vs EN ---
console.log('\n=== Cross-language key consistency (vs en) ===');
let localeConsistencyErrors = 0;
for (const lng of LANGS) {
  if (lng === 'en') continue;
  const flat = flatten(locales[lng]);
  const keys = new Set(Object.keys(flat));
  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));
  const untranslatedEmpty = [...keys].filter(
    (k) =>
      enKeys.has(k) &&
      (flat[k] === '' || flat[k] === null || flat[k] === undefined)
  );
  localeConsistencyErrors +=
    missing.length + extra.length + untranslatedEmpty.length;
  console.log(
    `${lng}: missing=${missing.length} extra=${extra.length} empty=${untranslatedEmpty.length}`
  );
  for (const k of missing) console.log(`  MISSING ${k}`);
  for (const k of extra) console.log(`  EXTRA   ${k}`);
  for (const k of untranslatedEmpty) console.log(`  EMPTY   ${k}`);
}

console.log('\n=== Dynamic prefixes detected in code ===');
for (const p of [...dynamicPrefixes].sort()) {
  const hits = [...enKeys].filter((k) => k.startsWith(p)).length;
  if (hits > 0) console.log(`  ${p}\${...}  -> matches ${hits} keys`);
}

console.log(
  `\n=== Unused keys in en.json: ${unused.length} of ${enKeys.size} ===`
);
for (const k of unused) console.log(`  ${k}`);

if (missingFromEn.length > 0 || localeConsistencyErrors > 0) {
  process.exitCode = 1;
}
