import React from 'react';
import { useTranslation } from 'react-i18next';

interface ITypedOrderReview {
  protocol: '0x' | 'Seaport';
  status: 'recognized' | 'unrecognized';
  warnings: ReadonlyArray<'send.nftOrderZeroPayment' | 'send.nftOrderNoReturn'>;
}

export const TypedOrderReview: React.FC<{
  review: ITypedOrderReview;
}> = ({ review }) => {
  const { t } = useTranslation();
  const hasWarning =
    review.status === 'recognized' && review.warnings.length > 0;
  const title = t('send.nftOrderReviewTitle', {
    protocol: review.protocol,
  });

  return (
    <section
      aria-label={title}
      className={`mt-4 min-w-0 rounded-lg border p-3 text-sm leading-relaxed ${
        hasWarning
          ? 'border-yellow-500/50 bg-yellow-900/10'
          : 'border-gray-700 bg-gray-900'
      }`}
    >
      <h2 className="mb-2 break-words font-semibold text-white">{title}</h2>
      {review.status === 'recognized' ? (
        <>
          {hasWarning && (
            <div className="mb-3 space-y-2 break-words text-yellow-200">
              <p className="font-medium">{t('send.nftOrderWarningTitle')}</p>
              {review.warnings.map((warning) => (
                <p key={warning}>{t(warning)}</p>
              ))}
            </div>
          )}
          <p className="break-words text-gray-300">
            {t('send.nftOrderAuthorization')}
          </p>
        </>
      ) : (
        <p className="break-words text-gray-300">
          {t('send.nftOrderUnrecognized')}
        </p>
      )}
      <p className="mt-3 break-words text-xs text-gray-400">
        {t('send.nftOrderReviewLimit')}
      </p>
    </section>
  );
};
