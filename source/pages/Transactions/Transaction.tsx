import React, { useState } from 'react';

import { Layout } from 'components/index';
import { useQueryData } from 'hooks/index';
import { getController } from 'utils/browser';

import Fee from './Fee';
import TransactionConfirmation from './TransactionConfirmation';

const titleResolver = (txType: string) => {
  switch (txType) {
    case 'CreateToken':
      return 'Create Token';

    case 'CreateNFT':
      return 'Create NFT';

    case 'MintToken':
      return 'Mint Token';

    case 'MintNFT':
      return 'Mint NFT';

    case 'UpdateToken':
      return 'Update Token';

    default:
      throw new Error('Unknown transaction type');
  }
};

const callbackResolver = (txType: string) => {
  let callbackName;

  switch (txType) {
    case 'CreateToken':
      callbackName = 'confirmTokenCreation';
      break;

    case 'CreateNFT':
      callbackName = 'confirmNftCreation';
      break;

    case 'MintToken':
      callbackName = 'confirmTokenMint';
      break;

    case 'MintNFT':
      callbackName = 'confirmMintNFT';
      break;

    case 'UpdateToken':
      callbackName = 'confirmUpdateToken';
      break;

    default:
      throw new Error('Unknown transaction type');
  }

  return getController().wallet.account.sys.tx[callbackName];
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
  const callback = callbackResolver(type);

  if (!fee) return <Fee title={title} onFinish={setFee} />;

  return (
    <Layout canGoBack={false} title={title}>
      <TransactionConfirmation
        host={host}
        title={title}
        type={type}
        transaction={{ ...transaction, fee }}
        callback={callback}
      />
    </Layout>
  );
};

export default Transaction;
