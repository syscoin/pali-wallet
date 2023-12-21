import React from 'react';

import { useTransactionsListConfig } from '../useTransactionsInfos';
import { useUtils } from 'hooks/useUtils';
import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';
import { ellipsis } from 'utils/index';

export const UtxoTransactionsListComponent = ({
  userTransactions,
  tx,
}: {
  tx: ITransactionInfoUtxo;
  userTransactions: ITransactionInfoUtxo[];
}) => {
  const { navigate } = useUtils();
  const { getTxStatus, formatTimeStampUtxo, blocktime } =
    useTransactionsListConfig(userTransactions);

  const isTxCanceled = tx?.isCanceled === true;
  const isConfirmed = tx.confirmations > 0;

  return (
    <div className="flex py-2 w-full border-b border-dashed border-bkg-deepBlue">
      <div className="flex flex-1 flex-col w-[]">
        <p className="text-xs">{ellipsis(tx.txid, 4, 14)}</p>
        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
      </div>
      <div className="flex flex-[0.8] flex-col">
        {formatTimeStampUtxo(tx[blocktime] * 1000)}
        <p className="text-xs">Transaction</p>
      </div>
      <div>
        <img
          className="cursor-pointer transition-all hover:opacity-60"
          src="/assets/icons/detailArrow.svg"
          onClick={() =>
            navigate('/home/details', {
              state: {
                id: null,
                hash: tx.txid,
              },
            })
          }
        />
      </div>
    </div>
  );
};

export const UtxoTransactionsList = ({
  userTransactions,
}: {
  userTransactions: ITransactionInfoUtxo[];
}) => {
  const { filteredTransactions } = useTransactionsListConfig(userTransactions);

  const array = filteredTransactions as ITransactionInfoUtxo[];

  return (
    <>
      {array.map((tx, idx) => (
        <UtxoTransactionsListComponent
          key={idx}
          tx={tx}
          userTransactions={userTransactions}
        />
      ))}
    </>
  );
};
