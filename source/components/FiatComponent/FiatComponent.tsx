import React, { FC, useState, useEffect } from 'react';

import { useStore, usePrice } from 'hooks/index';
import { getController } from 'utils/browser';
import { formatTransactionValue } from 'utils/index';

interface IFiatComponent {
  transactionValue: string;
}

export const FiatComponent: FC<IFiatComponent> = ({ transactionValue }) => {
  const controller = getController();

  const { getFiatAmount } = usePrice();

  const { fiat, activeAccount, activeNetwork, networks, activeToken } =
    useStore();

  const [fiatValue, setFiatValue] = useState<number | string>(0);

  const getTransactionValue = formatTransactionValue(
    transactionValue,
    activeNetwork,
    networks,
    activeToken,
    true
  );

  const getFiatPrice = async () => {
    try {
      const amount = await getFiatAmount(
        Number(getTransactionValue) || 0,
        2,
        String(fiat.asset).toUpperCase(),
        false
      );

      setFiatValue(amount);
    } catch (error) {
      setFiatValue(0);
    }
  };

  const isUnlocked =
    controller.wallet.isUnlocked() && activeAccount.address !== '';

  useEffect(() => {
    if (!transactionValue) return;

    getFiatPrice();
  }, [isUnlocked, activeNetwork]);

  return <>{fiatValue}</>;
};
