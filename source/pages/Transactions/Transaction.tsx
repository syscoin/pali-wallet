import React, { useState } from 'react';

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
  const [fee, setFee] = useState<number>();

  const title = titleResolver(type);

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
