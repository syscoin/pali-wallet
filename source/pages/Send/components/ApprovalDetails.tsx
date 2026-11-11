import React from 'react';
import { useTranslation } from 'react-i18next';

import { IApprovalAddressValues } from '../../../shared/approval';
import { AddressText } from 'components/AddressText';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

import { ReviewedAssetIcon } from './ReviewedAssetIcon';

interface IApprovalDetailsProps extends IApprovalAddressValues {
  approved?: boolean;
  context?: IEvmTransactionContext;
  formattedAmount?: string;
  isUnlimited?: boolean;
  standardVerified: boolean;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

export const ApprovalDetails: React.FC<IApprovalDetailsProps> = ({
  approved,
  approvalType,
  authority,
  authorityLabelKey,
  context,
  formattedAmount,
  isUnlimited = false,
  isValid,
  method,
  tokenContract,
  tokenDecimals,
  tokenSymbol,
  standardVerified,
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
        <span className="text-brand-graylight">
          {t(!standardVerified ? 'send.approvalAuthority' : authorityLabelKey)}
        </span>
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
        <span className="inline-flex items-center gap-2">
          {approvalType === 'erc20-amount' && context && (
            <ReviewedAssetIcon
              asset={{ contract: tokenContract, decimals: tokenDecimals }}
              context={context}
              size={24}
            />
          )}
          <AddressText
            className="text-brand-white"
            value={tokenContract}
            preset="short"
          />
        </span>
      </div>
      {!standardVerified &&
        approvalType === 'nft-all' &&
        typeof approved === 'boolean' && (
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-brand-graylight">
              {t('send.approvalRawValue')}
            </span>
            <span className="text-brand-white">{String(approved)}</span>
          </div>
        )}
      {approvalType === 'erc20-amount' && (
        <>
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="text-brand-graylight">{t('send.method')}</span>
            <span className="text-brand-white">
              {t(`transactions.methodNames.${method}`)}
            </span>
          </div>
          {formattedAmount !== undefined && (
            <div className="flex items-start justify-between gap-3 w-full">
              <span className="shrink-0 text-brand-graylight">
                {t(
                  !standardVerified
                    ? 'send.approvalRawValue'
                    : 'transactions.approvalAmount'
                )}
              </span>
              <span
                className={`min-w-0 break-all text-right ${
                  isUnlimited ? 'text-warning-error' : 'text-brand-white'
                }`}
              >
                {isUnlimited && standardVerified
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
