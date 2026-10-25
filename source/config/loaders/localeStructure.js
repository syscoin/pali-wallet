/* eslint-disable @typescript-eslint/no-var-requires -- Webpack loaders run as CommonJS in Node. */
// Build-time only. Translation keys/order are shared; values remain per locale.
const { projectLocale, scopeFromQuery } = require('./localeProjection');
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
  const resource = JSON.parse(source);
  structure(resource); // Validate even fields omitted by a projection.
  return (
    'module.exports=JSON.parse(' +
    JSON.stringify(
      JSON.stringify(
        structure(projectLocale(resource, scopeFromQuery(this?.resourceQuery)))
      )
    ) +
    ');'
  );
};
module.exports.structure = structure;
