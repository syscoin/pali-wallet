import React from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from 'components/Tooltip';

export const AccountExplorerAvatar = ({
  available,
  onClick,
  header = false,
}: {
  available: boolean;
  onClick: () => void;
  header?: boolean;
}) => {
  const { t } = useTranslation();
  const label =
    t('home.viewAccountOnExplorer') +
    (available ? '' : ` - ${t('settings.unavailable')}`);
  return (
    <Tooltip
      content={available ? t('home.viewOnExplorer') : label}
      childrenClassName={header ? 'shrink-0' : undefined}
    >
      <button
        type="button"
        aria-label={label}
        disabled={!available}
        className={
          'add-identicon ml-1 mr-2 my-2 cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80 rounded-full focus-visible:outline-none focus-visible:ring-2 ' +
          (header
            ? 'focus-visible:ring-brand-blue500'
            : 'focus-visible:ring-brand-royalblue')
        }
        onClick={onClick}
        title={label}
      />
    </Tooltip>
  );
};
