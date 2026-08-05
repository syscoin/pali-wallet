import React from 'react';
import { useTranslation } from 'react-i18next';

import { IApprovalAddressValues } from '../approval';
import { AddressText } from 'components/AddressText';

interface IApprovalDetailsProps extends IApprovalAddressValues {
  formattedAmount?: string;
  isUnlimited?: boolean;
  tokenSymbol?: string;
}

export const ApprovalDetails: React.FC<IApprovalDetailsProps> = ({
  approvalType,
  authority,
  authorityLabelKey,
  formattedAmount,
  isUnlimited = false,
  isValid,
  method,
  tokenContract,
  tokenSymbol,
}) => {
  const { t } = useTranslation();

  if (!isValid) {
    return (
      <div
        className="p-3 w-full max-w-sm text-xs text-warning-error rounded-xl bg-warning-error bg-opacity-10"
        role="alert"
      >
        {t('send.invalidApprovalDetails')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 w-full max-w-sm text-xs rounded-xl bg-bkg-2">
      <div className="flex items-center justify-between gap-3 w-full">
        <span className="text-brand-graylight">{t(authorityLabelKey)}</span>
        <AddressText
          className="text-brand-white"
          value={authority}
          preset="short"
        />
      </div>
      <div className="flex items-center justify-between gap-3 w-full">
        <span className="text-brand-graylight">
          {t('settings.contractAddress')}
        </span>
        <AddressText
          className="text-brand-white"
          value={tokenContract}
          preset="short"
        />
      </div>
      {approvalType === 'erc20-amount' && (
        <>
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-brand-graylight">{t('send.method')}</span>
            <span className="text-brand-white">
              {t(`transactions.methodNames.${method}`)}
            </span>
          </div>
          {formattedAmount !== undefined && (
            <div className="flex items-center justify-between gap-3 w-full">
              <span className="text-brand-graylight">
                {t('transactions.approvalAmount')}
              </span>
              <span
                className={
                  isUnlimited ? 'text-warning-error' : 'text-brand-white'
                }
              >
                {isUnlimited
                  ? `⚠️ ${t('transactions.unlimited')}`
                  : `${formattedAmount}${tokenSymbol ? ` ${tokenSymbol}` : ''}`}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
