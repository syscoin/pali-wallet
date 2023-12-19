import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { IFRAME } from 'trezor-connect';

import { useTransactionsListConfig } from '../useTransactionsInfos';
import { ConfirmationModal } from 'components/Modal';
import { StatusModal } from 'components/Modal/StatusModal';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ITransactionInfoEvm } from 'types/useTransactionsInfo';
import { getERC20TransferValue, isERC20Transfer } from 'utils/transactions';

export const EvmTransactionsListComponent = ({
  userTransactions,
  tx,
}: {
  tx: ITransactionInfoEvm;
  userTransactions: ITransactionInfoEvm[];
}) => {
  const { isBitcoinBased, activeAccount, accounts, coinsList } = useSelector(
    (state: RootState) => state.vault
  );
  const [showModal, setShowModal] = useState(false);

  const { navigate } = useUtils();
  const { getTxStatusIcons, getTxStatus, getTxType, txId, getTxOptions } =
    useTransactionsListConfig(userTransactions);
  const { getFiatAmount } = usePrice();

  const isTxCanceled = tx?.isCanceled === true;
  const isConfirmed = tx.confirmations > 0;
  const isErc20Tx = isERC20Transfer(tx as any);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const isTxSent = isBitcoinBased
    ? false
    : tx.from.toLowerCase() === currentAccount.address.toLowerCase();

  const tokenValue = !isConfirmed
    ? typeof tx.value === 'string'
      ? tx.value
      : Number(tx.value.hex) / 1e18
    : Number(tx.value) / 1e18;

  const finalTxValue = isErc20Tx
    ? Number(getERC20TransferValue(tx as any)) / 1e18
    : tokenValue;

  const getTokenSymbol = () => {
    if (isErc20Tx) {
      const token = coinsList.find((coin) =>
        Object.values(coin?.platforms || {})?.includes(tx?.to)
      );

      if (token) {
        return `${token?.symbol}`.toUpperCase();
      }

      return '';
    }

    return '';
  };

  // useEffect(() => {
  //   tx.confirmations > 0 ? setShowModal(true) : null;
  // }, []);

  // const closeModal = () => {
  //   setShowModal(false);
  // };

  return (
    <div className="flex flex-col w-full border-b border-dashed border-bkg-deepBlue">
      {/* <StatusModal
        status="success"
        title="Transaction concluded!"
        description="Your transaction was successfully concluded, check on blockexplorer!"
        show={showModal}
        onClose={closeModal}
      /> */}
      <div className="flex justify-between py-2 w-full">
        <div className="flex items-center">
          {getTxStatusIcons(getTxType(tx, isTxSent), false)}
          <div className="flex flex-col ">
            <div className="text-white text-xs font-normal">
              {getTxType(tx, isTxSent)}
            </div>
            <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col justify-end items-end">
            <div className="text-white text-xs font-normal">
              {Number(finalTxValue).toFixed(4)} {getTokenSymbol()}
            </div>
            <div className="text-brand-gray200 text-xs font-normal">
              ${getFiatAmount(+tx.value / 1e18, 6)}
            </div>
          </div>
          <div className="m-auto">
            {isConfirmed || isTxCanceled ? (
              <img
                className="cursor-pointer transition-all hover:opacity-60"
                src="/assets/icons/detailArrow.svg"
                onClick={() =>
                  navigate('/home/details', {
                    state: {
                      id: null,
                      hash: tx[txId],
                    },
                  })
                }
              />
            ) : (
              getTxOptions(isTxCanceled, isConfirmed, tx[txId])
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const EvmTransactionsList = ({
  userTransactions,
}: {
  userTransactions: ITransactionInfoEvm[];
}) => {
  const { filteredTransactions, formatTimeStamp, isOpenModal, modalData } =
    useTransactionsListConfig(userTransactions);

  const groupedTransactions = {};

  filteredTransactions.forEach((tx) => {
    const formattedDate = formatTimeStamp(tx.timestamp);

    if (!groupedTransactions[formattedDate]) {
      groupedTransactions[formattedDate] = [];
    }

    groupedTransactions[formattedDate].push(tx);
  });

  return (
    <>
      <ConfirmationModal show={isOpenModal} {...modalData} />
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
