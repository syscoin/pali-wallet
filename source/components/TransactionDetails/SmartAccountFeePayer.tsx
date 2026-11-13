import React from 'react';
import { useTranslation } from 'react-i18next';

/** The public payer captured by the same quote that authorizes submission. */
export function SmartAccountFeePayer({ address }: { address: string }) {
  const { t } = useTranslation();
  return (
    <div className="my-2 flex flex-col gap-1 text-xs">
      <span className="text-brand-gray200">
        {t('mobile.infrastructure.feePayer')}
      </span>
      <span className="break-all text-brand-white">{address}</span>
    </div>
  );
}
