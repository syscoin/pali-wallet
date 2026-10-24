import React from 'react';
import { useTranslation } from 'react-i18next';

import { translateTransactionType } from 'utils/transactionDisplay';

interface ITransactionHeaderProps {
  displayInfo: {
    displaySymbol: string;
    displayValue: number | string;
    formattedValue?: string;
    isNft: boolean;
    tokenId?: string;
  } | null;
  isLoading?: boolean;
  statusIcon: React.ReactNode;
  txStatus: React.ReactNode;
  txType: string;
}

export const TransactionHeader: React.FC<ITransactionHeaderProps> = ({
  txType,
  statusIcon,
  displayInfo,
  txStatus,
  isLoading = false,
}) => {
  const { t } = useTranslation();
  const formatDisplayValue = () => {
    if (!displayInfo) return '...';

    const valueStr = displayInfo.formattedValue ?? '0';

    if (displayInfo.isNft && displayInfo.tokenId) {
      return `${String(valueStr)} ${displayInfo.displaySymbol} #${
        displayInfo.tokenId
      }`;
    }

    return `${String(valueStr)} ${displayInfo.displaySymbol}`;
  };

  return (
    <div className="flex flex-col justify-center items-center w-full mb-2">
      {statusIcon}
      <p className="text-brand-gray200 text-xs font-light">
        {translateTransactionType(txType, t)}
      </p>
      <p className="min-w-0 max-w-full break-all text-center text-white text-base">
        {formatDisplayValue()}
      </p>
      <div>{txStatus}</div>
      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-royalblue"></div>
        </div>
      )}
    </div>
  );
};
