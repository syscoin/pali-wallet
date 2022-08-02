import React, { FC } from 'react';

import { usePrice, useStore } from 'hooks/index';
import { formatTransactionValue } from 'utils/index';

interface IFiatComponent {
  transactionValue: string;
}

export const FiatComponent: FC<IFiatComponent> = ({ transactionValue }) => {
  const { activeNetwork, fiat } = useStore();
  const { getFiatAmount } = usePrice();

  const { crypto, formattedFiatAmount } = formatTransactionValue(
    transactionValue,
    activeNetwork.chainId,
    fiat.asset,
    getFiatAmount
  );

  return !(transactionValue || formattedFiatAmount || crypto) ? null : (
    <div className="absolute right-8 flex flex-col items-start justify-start w-20">
      <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
        <p>{crypto}</p>
        <p>{formattedFiatAmount}</p>
      </div>
    </div>
  );
};
