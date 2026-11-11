import React from 'react';
import { useTranslation } from 'react-i18next';

import { useWalletUpdate } from 'hooks/useWalletUpdate';

export function WalletUpdateBadge() {
  const { t } = useTranslation();
  const { release, pendingVersion } = useWalletUpdate();
  if (!release && !pendingVersion) return null;
  return (
    <span className="ml-auto rounded-full bg-brand-pink px-2 py-0.5 text-[10px] font-medium text-white">
      {t('updates.available')}
    </span>
  );
}
