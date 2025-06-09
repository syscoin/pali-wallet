import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useQueryData } from 'hooks/index';
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
  const { t } = useTranslation();
  const [fee, setFee] = useState<number>();
  const titleResolver = (txType: string) =>
    camelCaseToText(txType).toUpperCase() || t('transactions.transaction');

  const title = titleResolver(type);

  useEffect(() => {
    // For Ethereum transactions, wait for fee to be set
    if (!fee) return;

    (async () => {
      const data = { host, ...transaction, fee: fee };

      if (type !== 'Send') return;

      navigate('/external/tx/send/confirm?data=' + JSON.stringify(data));
    })();
  }, [fee]);

  if (!fee) return <Fee title={title} onFinish={setFee} />;
};

export default Transaction;
