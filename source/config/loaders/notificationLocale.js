// Worker-only projection: share the source translations, not the React i18n
// bootstrap or whole UI dictionaries.
module.exports = function notificationLocale(source) {
  const { notifications } = JSON.parse(source);
  if (
    !notifications ||
    typeof notifications !== 'object' ||
    Array.isArray(notifications)
  ) {
    throw new Error('Missing notification translations');
  }
  if (Object.values(notifications).some((value) => typeof value !== 'string')) {
    throw new Error('Notification translations must be text');
  }
  return JSON.stringify({ notifications });
};
