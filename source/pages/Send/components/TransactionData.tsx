import React from 'react';

import { IDecodedTx } from 'types/transactions';

interface ITransactionDataProps {
  decodedTx: IDecodedTx;
}

export const TransactionDataComponent = (props: ITransactionDataProps) => {
  const { decodedTx } = props;

  return (
    <div className="flex flex-col items-center justify-center w-full">
      <p className="flex gap-1.5 items-center justify-start w-full text-sm">
        Method:
        <span className="text-brand-royalblue font-bold">
          {decodedTx.method}
        </span>
      </p>
      {decodedTx.method === 'Contract Interaction' ? (
        <div
          className="flex items-center justify-center mt-2 p-4 w-full text-xs rounded-xl"
          style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
        >
          <p>The decodification for this transaction is not available</p>
        </div>
      ) : (
        <pre
          className="scrollbar-styled mb-6 mt-2 px-2.5 py-1 w-full max-h-80 text-xs rounded-xl overflow-y-scroll"
          style={{ backgroundColor: 'rgba(22, 39, 66, 1)' }}
        >
          {JSON.stringify(decodedTx, null, '\t')}
        </pre>
      )}
    </div>
  );
};
