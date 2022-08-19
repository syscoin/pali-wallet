import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Layout } from 'components/index';
import { useQueryData } from 'hooks/index';

import Fee from './Fee';
import TransactionConfirmation from './TransactionConfirmation';

const titleResolver = (txType: string) => {
  switch (txType) {
    case 'CreateToken':
      return 'CREATE TOKEN';

    case 'CreateNFT':
      return 'CREATE NFT';

    case 'MintToken':
      return 'MINT TOKEN';

    case 'MintNFT':
      return 'MINT NFT';

    case 'Send':
      return 'SEND';

    case 'UpdateToken':
      return 'UPDATE TOKEN';

    default:
      throw new Error('Unknown transaction type');
  }
};

interface ITransaction {
  type: string;
}

/**
 * Alternates between Fee and Confirmation page
 */
const Transaction: React.FC<ITransaction> = ({ type }) => {
  const { host, ...transaction } = useQueryData();
  const navigate = useNavigate();

  const [fee, setFee] = useState<number>();

  const title = titleResolver(type);

  useEffect(() => {
    if (!fee) return;
    if (type !== 'Send') return;

    const data = { host, ...transaction, fee };
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
