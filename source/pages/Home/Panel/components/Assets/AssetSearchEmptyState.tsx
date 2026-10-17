import React from 'react';
import { useTranslation } from 'react-i18next';

export const AssetSearchEmptyState = ({
  onClearSearch,
}: {
  onClearSearch?: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center text-sm text-brand-white">
      <p role="status">{t('assetsHeader.noMatchingAssets')}</p>
      {onClearSearch && (
        <button
          type="button"
          onClick={onClearSearch}
          className="rounded px-3 py-2 text-brand-royalbluemedium underline hover:text-brand-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue"
        >
          {t('assetsHeader.clearSearch')}
        </button>
      )}
    </div>
  );
};
