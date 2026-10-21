import React from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from 'components/Tooltip';
import { IDecodedTx } from 'types/transactions';
import { convertBigNumberToString, isMaxUint256 } from 'utils/bigNumberUtils';
import { ellipsis } from 'utils/index';

interface IDecodedTransactionParamsProps {
  className?: string;
  decodedData: IDecodedTx | null;
}

export const DecodedTransactionParams: React.FC<
  IDecodedTransactionParamsProps
> = ({ decodedData, className = '' }) => {
  const { t } = useTranslation();

  // Helper to format addresses consistently with 0x prefix
  const formatAddress = (address: string): string => {
    if (!address) return '';
    // Ensure address has 0x prefix
    const addr = address.startsWith('0x') ? address : `0x${address}`;
    // Use ellipsis but ensure we keep the 0x prefix
    return `0x${ellipsis(addr.slice(2), 4, 4)}`;
  };

  if (!decodedData || !decodedData.method) {
    return null;
  }

  // Don't show decoded data section if there are no parameters and it's not a special case
  const isApproval = [
    'approve',
    'increaseallowance',
    'decreaseallowance',
    'setapprovalforall',
  ].includes(decodedData.method.toLowerCase());

  if (decodedData.inputs.length === 0 && !isApproval) {
    return null;
  }

  // Helper to format values based on type
  const formatValue = (value: any, type: string): string => {
    if (Array.isArray(value)) return JSON.stringify(value);

    if (type.includes('uint') || type.includes('int')) {
      // Keep tooltips exact; only the dedicated approval view uses Unlimited.
      return convertBigNumberToString(value);
    }

    if (type === 'address') {
      // Ensure addresses have 0x prefix in tooltips
      return value.startsWith('0x') ? value : `0x${value}`;
    }

    if (type === 'bool') {
      return value ? t('send.yes') : t('send.no');
    }

    return String(value);
  };

  const renderDetail = (label: string, content: React.ReactNode) => (
    <div className="flex items-center justify-between">
      <span className="text-xs text-brand-gray200">{label}:</span>
      {content}
    </div>
  );

  const renderAddress = (address: string) => {
    const display = formatAddress(address);
    return (
      <Tooltip content={address} focusable={display !== address}>
        <span className="text-xs text-white font-mono">{display}</span>
      </Tooltip>
    );
  };

  // Special formatting for approval transactions
  const renderApprovalDetails = () => {
    const approvalData = decodedData as any;

    if (approvalData.approvalType === 'erc20-amount') {
      const amount = approvalData.inputs[1];
      const amountStr = convertBigNumberToString(amount);
      const isUnlimited = isMaxUint256(amountStr);

      return (
        <div className="space-y-2">
          {renderDetail(
            t('transactions.spender'),
            renderAddress(approvalData.inputs[0])
          )}
          {renderDetail(
            t('transactions.approvalAmount'),
            <span
              className={`text-xs font-medium ${
                isUnlimited ? 'text-warning-error' : 'text-white'
              }`}
            >
              {isUnlimited ? `⚠️ ${t('transactions.unlimited')}` : amountStr}
            </span>
          )}
          {approvalData.tokenStandard &&
            renderDetail(
              t('transactions.tokenStandard'),
              <span className="text-xs text-white">
                {approvalData.tokenStandard}
              </span>
            )}
        </div>
      );
    }

    if (approvalData.approvalType === 'erc721-single') {
      return (
        <div className="space-y-2">
          {renderDetail(
            t('transactions.approvedTo'),
            renderAddress(approvalData.inputs[0])
          )}
          {renderDetail(
            t('send.tokenId'),
            <span className="text-xs text-white">
              #{approvalData.inputs[1].toString()}
            </span>
          )}
        </div>
      );
    }

    if (approvalData.approvalType === 'nft-all') {
      return (
        <div className="space-y-2">
          {renderDetail(
            t('transactions.operator'),
            renderAddress(approvalData.inputs[0])
          )}
          {renderDetail(
            t('transactions.approvalStatus'),
            <span
              className={`text-xs font-medium ${
                approvalData.inputs[1]
                  ? 'text-warning-success'
                  : 'text-brand-gray200'
              }`}
            >
              {approvalData.inputs[1]
                ? `✓ ${t('transactions.approved')}`
                : `✗ ${t('transactions.revoked')}`}
            </span>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className={`mt-4 ${className}`}>
      <p className="text-sm font-semibold text-white mb-3">
        {t('transactions.decodedData')}
      </p>

      <div className="p-3 bg-bkg-2 rounded-lg">
        {isApproval && renderApprovalDetails()}

        {!isApproval && decodedData.inputs.length > 0 && (
          <div className="space-y-2">
            {decodedData.inputs.map((input, index) => {
              const value = formatValue(input, decodedData.types[index]);
              const display =
                decodedData.types[index] === 'address'
                  ? formatAddress(input)
                  : value.length > 20
                  ? ellipsis(value, 10, 4)
                  : value;
              return (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-xs text-brand-gray200">
                    {decodedData.names[index] || `param${index}`}
                    <span className="text-brand-gray400 ml-1">
                      ({decodedData.types[index]})
                    </span>
                    :
                  </span>
                  <Tooltip content={value} focusable={display !== value}>
                    <span className="text-xs text-white font-mono">
                      {display}
                    </span>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
