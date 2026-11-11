import React from 'react';
import { useTranslation } from 'react-i18next';

import type { AssetTransferDisplay } from '../../../shared/assetTransferDisplay';

/** A calldata summary is descriptive; the call's separate native value and fees remain visible. */
export function AssetTransferSummary({
  transfer,
  compact = false,
}: {
  compact?: boolean;
  transfer: AssetTransferDisplay;
}) {
  const { t } = useTranslation();
  const fact = (label: string, value: string) => (
    <div className="flex flex-col gap-1 text-left min-w-0">
      <dt className="text-brand-gray200 text-xs">{t(label)}</dt>
      <dd className="text-brand-white text-xs font-mono break-all select-text">
        {value}
      </dd>
    </div>
  );
  return (
    <section
      aria-label={t('assetTransfer.summary')}
      className={compact ? 'mt-3 space-y-3' : 'w-full space-y-4'}
    >
      <div className="space-y-2 text-center">
        <p className="text-brand-gray200 text-xs">
          {t(`assetTransfer.${transfer.heading}`)}
        </p>
        {transfer.items.map((item, index) => (
          <div key={index} className="min-w-0">
            <p
              className={`${
                compact ? 'text-lg' : 'text-2xl'
              } text-brand-white font-medium break-all select-text`}
            >
              {item.tokenId === null ? item.value : `#${item.tokenId}`}
            </p>
            <p className="text-sm text-brand-gray200 break-all">
              {item.symbol ??
                (item.tokenId === null
                  ? t('assetTransfer.rawUnits')
                  : `${item.units} ${t('assetTransfer.units')}`)}
            </p>
          </div>
        ))}
        {!transfer.standardVerified && (
          <p className="text-brand-gray200 text-xs">
            {t('assetTransfer.unverified')}
          </p>
        )}
        {transfer.heading === 'token-transfer' && (
          <p className="text-brand-gray200 text-xs">
            {t('assetTransfer.contractMetadata')}
          </p>
        )}
      </div>
      <dl className="space-y-3 rounded-xl bg-brand-blue600 p-3">
        {fact('assetTransfer.recipient', transfer.recipient)}
        {fact('assetTransfer.contract', transfer.contract)}
        {transfer.from && fact('assetTransfer.owner', transfer.from)}
      </dl>
    </section>
  );
}
