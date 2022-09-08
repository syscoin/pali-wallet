import React, { FC } from 'react';
import { useSelector } from 'react-redux';

import { usePrice } from 'hooks/index';
import { RootState } from 'state/store';
import { formatTransactionValue } from 'utils/index';

interface IFiatComponent {
  transactionValue: string;
}

export const FiatComponent: FC<IFiatComponent> = ({ transactionValue }) => {
  const {
    vault: { activeNetwork },
    price: { fiat },
  } = useSelector((state: RootState) => state);

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
