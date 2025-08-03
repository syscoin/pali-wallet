import React from 'react';

import { removeScientificNotation } from 'utils/index';

interface ITransactionHeaderProps {
  displayInfo: {
    displaySymbol: string;
    displayValue: number | string;
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
  const formatDisplayValue = () => {
    if (!displayInfo) return '...';

    const value = isNaN(Number(displayInfo.displayValue))
      ? '0'
      : removeScientificNotation(Number(displayInfo.displayValue));

    if (displayInfo.isNft && displayInfo.tokenId) {
      return `${value} ${displayInfo.displaySymbol} #${displayInfo.tokenId}`;
    }

    return `${value} ${displayInfo.displaySymbol}`;
  };

  return (
    <div className="flex flex-col justify-center items-center w-full mb-2">
      {statusIcon}
      <p className="text-brand-gray200 text-xs font-light">{txType}</p>
      <p className="text-white text-base">{formatDisplayValue()}</p>
      <div>{txStatus}</div>
      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-brand-royalblue"></div>
        </div>
      )}
    </div>
  );
};
