import React from 'react';
import { useTranslation } from 'react-i18next';

export const ListLoadMore = ({
  onClick,
  shown,
  total,
}: {
  onClick: () => void;
  shown: number;
  total: number;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center py-3">
      <button
        type="button"
        onClick={onClick}
        className="px-3 py-1.5 text-xs rounded border border-bkg-white200 text-white hover:bg-alpha-whiteAlpha50 transition-colors"
      >
        {t('buttons.loadMore')} ({shown}/{total})
      </button>
    </div>
  );
};
