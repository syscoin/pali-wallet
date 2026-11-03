import React from 'react';
import { useTranslation } from 'react-i18next';

const fieldKey = (name: string) => {
  if (!name.startsWith('previous') || name.length <= 8) return name;
  const suffix = name.slice(8);
  return suffix.startsWith('PQ')
    ? `pq${suffix.slice(2)}`
    : suffix[0].toLowerCase() + suffix.slice(1);
};

// Preserve unknown future fields using a readable technical fallback.
const humanize = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());

export const SentryManagementFields = ({
  fields,
}: {
  fields: Record<string, string>;
}) => {
  const { t } = useTranslation();
  const previousKeys = new Set(
    Object.keys(fields)
      .filter((name) => name.startsWith('previous'))
      .map(fieldKey)
  );
  return (
    <>
      {Object.entries(fields).map(([name, value]) => {
        const previous = name.startsWith('previous') && name.length > 8;
        const key = fieldKey(name);
        const label =
          key === 'collateral'
            ? t('sentry.collateralOutpoint')
            : key === 'service'
            ? t('sentry.service')
            : t(`sentry.managementFields.${key}`, {
                defaultValue: humanize(key),
              });
        const qualifier = previous
          ? t('sentry.current')
          : previousKeys.has(key)
          ? t('sentry.proposed')
          : '';
        return (
          <div key={name} className="break-all">
            <p>{qualifier ? `${qualifier}: ${label}` : label}</p>
            <p className="text-white">{value || t('sentry.notSet')}</p>
          </div>
        );
      })}
    </>
  );
};
