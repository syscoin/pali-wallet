import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../useTransactionsInfos';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { removeScientificNotation } from 'utils/index';

export const EvmTransactionsListComponent = ({
  userTransactions,
  tx,
}: {
  //TODO: adjust type
  tx: any;
  userTransactions: any;
}) => {
  const { t } = useTranslation();
  const { isBitcoinBased, activeAccount, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const { navigate } = useUtils();

  const { getTxStatusIcons, getTxStatus, getTxType, txid } =
    useTransactionsListConfig(userTransactions);
  const { getFiatAmount } = usePrice();

  const isTxCanceled = tx?.isCanceled === true;
  const isConfirmed = tx.confirmations > 0;

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const isTxSent = isBitcoinBased
    ? false
    : tx.from.toLowerCase() === currentAccount.address;

  return (
    <div className="flex flex-col w-full border-b border-dashed border-bkg-deepBlue">
      <div className="flex justify-between py-2 w-full">
        <div className="flex items-center">
          <div className="relative w-[36px] h-[36px] bg-brand-whiteAlpaBlue rounded-[100px] mr-2">
            {getTxStatusIcons(getTxType(tx, isTxSent))}
          </div>
          <div className="flex flex-col ">
            <div className="text-white text-xs font-normal">
              {getTxType(tx, isTxSent)}
            </div>
            <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col justify-end">
            <div className="text-white text-xs font-normal">
              {removeScientificNotation(Number(tx.value) / 10 ** 18)}
            </div>
            <div className="text-brand-gray200 text-xs font-normal">
              ${getFiatAmount(tx.value / 1e18, 6)}
            </div>
          </div>
          <div>
            <img
              className="cursor-pointer transition-all hover:opacity-60"
              src="/assets/icons/detailArrow.svg"
              onClick={() =>
                navigate('/home/details', {
                  state: {
                    id: null,
                    hash: tx[txid],
                  },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export const EvmTransactionsList = ({
  userTransactions,
}: {
  userTransactions: any; //TODO: adjust type
}) => {
  const { filteredTransactions, formatTimeStamp } =
    useTransactionsListConfig(userTransactions);

  const groupedTransactions = {};

  filteredTransactions.forEach((tx) => {
    const formattedDate = formatTimeStamp(tx.timestamp);

    if (!groupedTransactions[formattedDate]) {
      groupedTransactions[formattedDate] = [];
    }

    groupedTransactions[formattedDate].push(tx);
  });

  console.log(groupedTransactions, 'groupedArray');
  return (
    <>
      {Object.entries(groupedTransactions).map(([date, transactions]: any) => (
        <div key={date} className="mb-[20px]">
          <div className="text-xs text-white font-normal">{date}</div>
          {transactions.map((tx, idx) => (
            <EvmTransactionsListComponent
              key={idx}
              tx={tx}
              userTransactions={userTransactions}
            />
          ))}
        </div>
      ))}
    </>
  );
};
