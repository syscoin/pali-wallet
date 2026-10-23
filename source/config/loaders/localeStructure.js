// Build-time only. Translation keys/order are shared; values remain per locale.
const structure = (value) => {
  if (typeof value === 'string') return 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Locale resources must contain only objects and text');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, structure(child)])
  );
};

module.exports = function localeStructure(source) {
  return (
    'module.exports=JSON.parse(' +
    JSON.stringify(JSON.stringify(structure(JSON.parse(source)))) +
    ');'
  );
};
module.exports.structure = structure;
