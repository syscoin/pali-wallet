const fs = require('fs');
const path = require('path');
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
  const values = (node) =>
    typeof node === 'string' ? [node] : Object.values(node).flatMap(values);
  return (
    'module.exports=require("utils/restoreLocale").restoreLocale(require("assets/locales/en.json?localeStructure"),' +
    JSON.stringify(values(resource)) +
    ');'
  );
};
