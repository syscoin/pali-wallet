// Factor repeated object shapes while preserving every JSON field and fresh object.
module.exports = function compactAbiJson(source) {
  const value = JSON.parse(source);
  if (!Array.isArray(value)) throw new Error('Expected a contract ABI array');
  function literal(node) {
    if (!node || typeof node !== 'object') return JSON.stringify(node);
    if (Array.isArray(node)) return '[' + node.map(literal).join(',') + ']';
    return (
      '{' +
      Object.keys(node)
        .map(
          (field) => '[' + JSON.stringify(field) + ']:' + literal(node[field])
        )
        .join(',') +
      '}'
    );
  }
  const groups = new Map();
  const keyFor = (object) => JSON.stringify(Object.keys(object));
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node)) {
      const key = keyFor(node);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
    Object.values(node).forEach(collect);
  }
  collect(value);
  const templates = new Map();
  let number = 0;
  for (const [key, objects] of groups) {
    if (objects.length < 3) continue;
    const keys = Object.keys(objects[0]);
    const slots = [];
    const fields = keys.map((field) => {
      const first = objects[0][field];
      if (
        objects.every(
          (object) => JSON.stringify(object[field]) === JSON.stringify(first)
        )
      )
        return { field, constant: literal(first) };
      const same = slots.findIndex((previous) =>
        objects.every(
          (object) =>
            object[field] === object[previous] &&
            (object[field] === null || typeof object[field] !== 'object')
        )
      );
      if (same >= 0) return { field, slot: same };
      slots.push(field);
      return { field, slot: slots.length - 1 };
    });
    templates.set(key, { name: 'f' + number++, slots, fields });
  }
  function encode(node) {
    if (!node || typeof node !== 'object') return JSON.stringify(node);
    if (Array.isArray(node)) return '[' + node.map(encode).join(',') + ']';
    const template = templates.get(keyFor(node));
    if (template)
      return (
        template.name +
        '(' +
        template.slots.map((field) => encode(node[field])).join(',') +
        ')'
      );
    return (
      '{' +
      Object.keys(node)
        .map(
          (field) => '[' + JSON.stringify(field) + ']:' + encode(node[field])
        )
        .join(',') +
      '}'
    );
  }
  const declarations = [...templates.values()]
    .map(
      (template) =>
        'function ' +
        template.name +
        '(' +
        template.slots.map((_, index) => 'a' + index).join(',') +
        '){return {' +
        template.fields
          .map(
            ({ field, constant, slot }) =>
              '[' +
              JSON.stringify(field) +
              ']:' +
              (constant === undefined ? 'a' + slot : constant)
          )
          .join(',') +
        '};}'
    )
    .join('\n');
  const generated = declarations + '\nmodule.exports=' + encode(value) + ';';
  // Only pool immutable strings; every object and array still has its own literal.
  // Generated strings are JSON literals, so escaped quotes and backslashes stay intact.
  const stringLiteral = /"(?:[^"\\]|\\.)*"/g;
  const counts = new Map();
  for (const [string] of generated.matchAll(stringLiteral)) {
    counts.set(string, (counts.get(string) || 0) + 1);
  }
  // Production minification gives local constants short names. Skip literals whose
  // repeated references would not repay their declaration and initializer.
  const pooled = [...counts]
    .filter(
      ([string, count]) => (string.length - 1) * count > string.length + 8
    )
    .sort((left, right) => right[1] - left[1]);
  if (!pooled.length) return generated;
  const names = new Map(pooled.map(([string], index) => [string, 's' + index]));
  return (
    'const ' +
    pooled.map(([string], index) => 's' + index + '=' + string).join(',') +
    ';' +
    generated.replace(stringLiteral, (string) => names.get(string) || string)
  );
};
