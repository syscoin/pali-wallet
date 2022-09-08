import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { camelCaseToText } from 'utils/format';

import Fee from './Fee';
import TransactionConfirmation from './TransactionConfirmation';

const titleResolver = (txType: string) =>
  camelCaseToText(txType).toUpperCase() || 'TRANSACTION';

interface ITransaction {
  type: string;
}

/**
 * Alternates between Fee and Confirmation page
 */
const Transaction: React.FC<ITransaction> = ({ type }) => {
  const { host, ...transaction } = useQueryData();
  const navigate = useNavigate();
  const {
    wallet: { txs },
  } = getController();

  const [fee, setFee] = useState<number>();

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const title = titleResolver(type);

  useEffect(() => {
    if (!fee) return;

    const recommended = isBitcoinBased
      ? txs.getRecommendedFee(activeNetwork.url)
      : fee;

    const data = { host, ...transaction, fee: recommended };

    if (type !== 'Send') return;

    navigate('/external/tx/send/confirm?data=' + JSON.stringify(data));
  }, [fee]);

  if (!fee) return <Fee title={title} onFinish={setFee} />;

  return (
    <Layout canGoBack={false} title={title}>
      <TransactionConfirmation
        host={host}
        title={title}
        type={type}
        transaction={{ ...transaction, fee }}
      />
    </Layout>
  );
};

export default Transaction;
