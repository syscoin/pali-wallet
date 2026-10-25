// These partitions share the source JSON; no translated text is duplicated.
const scopeFromQuery = (query = '') => {
  if (query === '?baseMessages' || query === '?baseStructure') return 'base';
  if (query === '?privacyMessages' || query === '?privacyStructure')
    return 'privacy';
  if (!query || query === '?localeStructure') return 'full';
  throw new Error('Unknown locale projection');
};

const projectLocale = (resource, scope) => {
  if (scope === 'full') return resource;
  if (!resource.privacy || typeof resource.privacy.title !== 'string') {
    throw new Error('Missing Privacy locale title');
  }
  if (scope === 'base') {
    return { ...resource, privacy: { title: resource.privacy.title } };
  }
  return {
    privacy: Object.fromEntries(
      Object.entries(resource.privacy).filter(([key]) => key !== 'title')
    ),
  };
};

module.exports = { projectLocale, scopeFromQuery };
