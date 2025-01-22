import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { camelCaseToText } from 'utils/format';

import Fee from './Fee';

interface ITransaction {
  type: string;
}

/**
 * Alternates between Fee and Confirmation page
 */
const Transaction: React.FC<ITransaction> = ({ type }) => {
  const { host, ...transaction } = useQueryData();
  const navigate = useNavigate();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const [fee, setFee] = useState<number>();
  const titleResolver = (txType: string) =>
    camelCaseToText(txType).toUpperCase() || t('transactions.transaction');
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const title = titleResolver(type);

  useEffect(() => {
    if (!fee) return;

    (async () => {
      const recommended = isBitcoinBased
        ? await controllerEmitter(
            ['wallet', 'syscoinTransaction', 'getRecommendedFee'],
            [activeNetwork.url]
          )
        : fee;

      const data = { host, ...transaction, fee: recommended };

      if (type !== 'Send') return;

      navigate('/external/tx/send/confirm?data=' + JSON.stringify(data));
    })();
  }, [fee]);

  if (!fee) return <Fee title={title} onFinish={setFee} />;
};

export default Transaction;
