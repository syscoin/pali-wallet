/* eslint-disable @typescript-eslint/no-var-requires -- Webpack loaders run as CommonJS in Node. */
const fs = require('fs');
const path = require('path');

const { projectLocale, scopeFromQuery } = require('./localeProjection');
const { structure } = require('./localeStructure');

// Build-time work only. Unscanned text remains an ordinary exact string literal.
const MAX_SCAN_CODEPOINTS = 2048;
const MAX_WORDS = 256;
const MAX_CANDIDATES = 150000;
const MAX_REPLACEMENTS = 512;
const byteLength = (value) => Buffer.byteLength(value);
const expression = (parts) =>
  parts
    .map((part) =>
      typeof part === 'string' ? JSON.stringify(part) : part.name
    )
    .join('+');

function poolFragments(flattened, names) {
  const counts = new Map();
  for (const value of flattened)
    counts.set(value, (counts.get(value) || 0) + 1);
  // A whole-value constant is emitted once, regardless of how often it is used.
  const weight = (value) => (names.has(value) ? 1 : counts.get(value));
  const parts = new Map([...counts.keys()].map((value) => [value, [value]]));
  const candidates = new Map();
  for (const value of counts.keys()) {
    const text = Array.from(value).slice(0, MAX_SCAN_CODEPOINTS).join('');
    const found = new Set();
    const words = [...text.matchAll(/\S+\s*/gu)].slice(0, MAX_WORDS);
    for (let start = 0; start < words.length; start++) {
      for (let end = start; end < Math.min(words.length, start + 12); end++) {
        const fragment = text.slice(
          words[start].index,
          words[end].index + words[end][0].length
        );
        if (fragment.length > 110) break;
        if (fragment.length >= 8) found.add(fragment);
      }
    }
    // Word boundaries do not cover CJK text, or phrases inside Korean words.
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        text
      )
    ) {
      const characters = Array.from(text);
      for (const length of [4, 6, 8, 12, 16, 24, 32]) {
        for (let start = 0; start + length <= characters.length; start++) {
          found.add(characters.slice(start, start + length).join(''));
        }
      }
    }
    for (const fragment of found) {
      const previous = candidates.get(fragment);
      if (!previous && candidates.size >= MAX_CANDIDATES) continue;
      candidates.set(fragment, {
        uses: (previous?.uses || 0) + weight(value),
        distinct: (previous?.distinct || 0) + 1,
      });
    }
  }
  const ranked = [...candidates]
    .filter(([, count]) => count.distinct > 1)
    .map(([fragment, count]) => [
      fragment,
      count.uses * (byteLength(JSON.stringify(fragment)) - 6) -
        (byteLength(JSON.stringify(fragment)) + 7),
    ])
    .filter(([, saving]) => saving > 0)
    .sort(
      ([left, a], [right, b]) =>
        b - a ||
        right.length - left.length ||
        (left < right ? -1 : left > right ? 1 : 0)
    )
    .slice(0, MAX_REPLACEMENTS);
  const declarations = [];
  for (const [fragment] of ranked) {
    const name = `s${declarations.length}`;
    const declaration = `${name}=${JSON.stringify(fragment)}`;
    let saving = -byteLength(declaration + ',');
    const changes = [];
    for (const [value, previous] of parts) {
      if (
        !previous.some(
          (part) => typeof part === 'string' && part.includes(fragment)
        )
      )
        continue;
      const next = previous.flatMap((part) => {
        if (typeof part !== 'string' || !part.includes(fragment)) return [part];
        const split = part.split(fragment),
          replacement = [];
        split.forEach((text, index) => {
          if (index) replacement.push({ name });
          if (text) replacement.push(text);
        });
        return replacement;
      });
      saving +=
        (byteLength(expression(previous)) - byteLength(expression(next))) *
        weight(value);
      changes.push([value, next]);
    }
    if (saving <= 0) continue;
    declarations.push(declaration);
    for (const [value, next] of changes) parts.set(value, next);
  }
  // Fragment constants precede whole values; no declaration references a later one.
  const all = [
    ...declarations,
    ...[...names].map(
      ([value, name]) => `${name}=${expression(parts.get(value))}`
    ),
  ];
  return {
    prefix: all.length ? `const ${all.join(',')};` : '',
    array: `[${flattened
      .map((value) => names.get(value) || expression(parts.get(value)))
      .join(',')}]`,
  };
}

module.exports = function compactLocaleJson(source) {
  const resource = JSON.parse(source);
  const englishPath = path.join(path.dirname(this.resourcePath), 'en.json');
  this.addDependency(englishPath);
  const canonical = structure(JSON.parse(fs.readFileSync(englishPath, 'utf8')));
  const actual = structure(resource);
  // A changed key/order may not shift positional translations silently.
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new Error('Locale resource structure/order differs from English');
  }
  const scope = scopeFromQuery(this.resourceQuery);
  const projection = projectLocale(resource, scope);
  const structureQuery =
    scope === 'full' ? 'localeStructure' : `${scope}Structure`;
  const values = (node) =>
    typeof node === 'string' ? [node] : Object.values(node).flatMap(values);
  const flattened = values(projection);
  const counts = new Map();
  for (const value of flattened)
    counts.set(value, (counts.get(value) || 0) + 1);
  const declarations = [];
  const names = new Map();
  for (const [value, count] of counts) {
    const name = `p${declarations.length}`;
    const literal = JSON.stringify(value);
    const literalBytes = Buffer.byteLength(literal);
    const nameBytes = Buffer.byteLength(name);
    // Include the complete declaration and its comma before choosing a value.
    if (
      count > 1 &&
      count * (literalBytes - nameBytes) > nameBytes + literalBytes + 2
    ) {
      names.set(value, name);
      declarations.push(`${name}=${literal}`);
    }
  }
  const plain = JSON.stringify(flattened);
  const prefix = `const ${declarations.join(',')};`;
  const pooled = `[${flattened
    .map((value) => names.get(value) || JSON.stringify(value))
    .join(',')}]`;
  const usePool =
    declarations.length > 0 &&
    Buffer.byteLength(prefix + pooled) < Buffer.byteLength(plain);
  const current = {
    prefix: usePool ? prefix : '',
    array: usePool ? pooled : plain,
  };
  const shared = poolFragments(flattened, usePool ? names : new Map());
  // Keep the established complete module if the new factoring does not win.
  const selected =
    byteLength(shared.prefix + shared.array) <
    byteLength(current.prefix + current.array)
      ? shared
      : current;
  return (
    selected.prefix +
    'module.exports=require("utils/restoreLocale").restoreLocale(require("assets/locales/en.json?' +
    structureQuery +
    '"),' +
    selected.array +
    ');'
  );
};
