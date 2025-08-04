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
    'increaseAllowance',
    'decreaseAllowance',
    'setApprovalForAll',
  ].includes(decodedData.method.toLowerCase());

  if (decodedData.inputs.length === 0 && !isApproval) {
    return null;
  }

  // Helper to format values based on type
  const formatValue = (value: any, type: string): string => {
    if (type.includes('uint') || type.includes('int')) {
      // Use the utility to handle BigNumber conversion
      const numStr = convertBigNumberToString(value);

      if (type.includes('uint256') && numStr.length > 10) {
        // Check if it's the max uint256 (unlimited approval)
        if (isMaxUint256(numStr)) {
          return t('transactions.unlimited');
        }
        // Otherwise show truncated for very large numbers
        return numStr.length > 20
          ? `${numStr.slice(0, 6)}...${numStr.slice(-4)}`
          : numStr;
      }
      return numStr;
    }

    if (type === 'address') {
      // Ensure addresses have 0x prefix in tooltips
      return value.startsWith('0x') ? value : `0x${value}`;
    }

    if (type === 'bool') {
      return value ? t('send.yes') : t('send.no');
    }

    if (type === 'bytes' || type.startsWith('bytes')) {
      return value.slice(0, 10) + '...';
    }

    return String(value);
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
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('transactions.spender')}:
            </span>
            <Tooltip content={approvalData.inputs[0]}>
              <span className="text-xs text-white font-mono">
                {formatAddress(approvalData.inputs[0])}
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('transactions.approvalAmount')}:
            </span>
            <span
              className={`text-xs font-medium ${
                isUnlimited ? 'text-warning-error' : 'text-white'
              }`}
            >
              {isUnlimited ? `⚠️ ${t('transactions.unlimited')}` : amountStr}
            </span>
          </div>
          {approvalData.tokenStandard && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-brand-gray200">
                {t('transactions.tokenStandard')}:
              </span>
              <span className="text-xs text-white">
                {approvalData.tokenStandard}
              </span>
            </div>
          )}
        </div>
      );
    }

    if (approvalData.approvalType === 'erc721-single') {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('transactions.approvedTo')}:
            </span>
            <Tooltip content={approvalData.inputs[0]}>
              <span className="text-xs text-white font-mono">
                {formatAddress(approvalData.inputs[0])}
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('send.tokenId')}:
            </span>
            <span className="text-xs text-white">
              #{approvalData.inputs[1].toString()}
            </span>
          </div>
        </div>
      );
    }

    if (approvalData.approvalType === 'nft-all') {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('transactions.operator')}:
            </span>
            <Tooltip content={approvalData.inputs[0]}>
              <span className="text-xs text-white font-mono">
                {formatAddress(approvalData.inputs[0])}
              </span>
            </Tooltip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-gray200">
              {t('transactions.approvalStatus')}:
            </span>
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
          </div>
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
            {decodedData.inputs.map((input, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-xs text-brand-gray200">
                  {decodedData.names[index] || `param${index}`}
                  <span className="text-brand-gray400 ml-1">
                    ({decodedData.types[index]})
                  </span>
                  :
                </span>
                <Tooltip content={formatValue(input, decodedData.types[index])}>
                  <span className="text-xs text-white font-mono">
                    {decodedData.types[index] === 'address'
                      ? formatAddress(input)
                      : formatValue(input, decodedData.types[index]).length > 20
                      ? ellipsis(
                          formatValue(input, decodedData.types[index]),
                          10,
                          4
                        )
                      : formatValue(input, decodedData.types[index])}
                  </span>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
