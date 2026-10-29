/* eslint-disable @typescript-eslint/no-var-requires -- Webpack loaders run as CommonJS in Node. */
const fs = require('fs');
const path = require('path');

const { projectLocale, scopeFromQuery } = require('./localeProjection');
const { structure } = require('./localeStructure');

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
  return (
    (usePool ? prefix : '') +
    'module.exports=require("utils/restoreLocale").restoreLocale(require("assets/locales/en.json?' +
    structureQuery +
    '"),' +
    (usePool ? pooled : plain) +
    ');'
  );
};
