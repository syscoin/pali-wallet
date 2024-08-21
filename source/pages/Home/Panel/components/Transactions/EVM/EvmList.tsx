import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { ConfirmationModal } from 'components/Modal';
import { StatusModal } from 'components/Modal/StatusModal';
import { TransactionOptions } from 'components/TransactionOptions';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { ITransactionInfoEvm, modalDataType } from 'types/useTransactionsInfo';
import {
  getERC20TransferValue,
  handleUpdateTransaction,
  isERC20Transfer,
} from 'utils/transactions';

export const EvmTransactionsList = ({
  userTransactions,
}: {
  userTransactions: ITransactionInfoEvm[];
}) => {
  const {
    isBitcoinBased,
    activeAccount,
    accounts,
    coinsList,
    activeNetwork: { chainId },
    isLastTxConfirmed,
  } = useSelector((state: RootState) => state.vault);

  const {
    filteredTransactions,
    formatTimeStamp,
    getTxStatusIcons,
    getTxStatus,
    getTokenSymbol,
    getTxType,
    txId,
  } = useTransactionsListConfig(userTransactions);
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();
  const { controllerEmitter } = useController();

  const [modalData, setModalData] = useState<modalDataType>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [showModal, setShowModal] = useState(false);
  const [groupedTransactions, setGroupedTransactions] = useState<{
    [date: string]: ITransactionInfoEvm[];
  }>({});

  const currentAccount = useMemo(
    () => accounts[activeAccount.type][activeAccount.id],
    [accounts, activeAccount]
  );

  const getTxOptions = useCallback(
    (isCanceled: boolean, isConfirmed: boolean, tx: ITransactionInfoEvm) => {
      if (!isCanceled && !isConfirmed) {
        return (
          <TransactionOptions
            handleUpdateTransaction={handleUpdateTransaction}
            alert={alert}
            chainId={chainId}
            transaction={tx as any}
            setIsOpenModal={setIsOpenModal}
            setModalData={setModalData}
          />
        );
      }
      return null;
    },
    [handleUpdateTransaction, alert, chainId, setIsOpenModal, setModalData]
  );

  const EvmTransactionsListComponent = useCallback(({ tx }) => {
    const isTxCanceled = tx?.isCanceled === true;
    const isConfirmed = tx?.confirmations > 0;
    const isErc20Tx = isERC20Transfer(tx as any);
    const isTxSent = isBitcoinBased
      ? false
      : tx?.from?.toLowerCase() === currentAccount?.address?.toLowerCase();
    const tokenValue = !isConfirmed
      ? typeof tx?.value === 'string'
        ? tx?.value
        : Number(tx?.value?.hex) / 1e18
      : Number(tx?.value?.hex) / 1e18;
    const finalTxValue = isErc20Tx
      ? Number(getERC20TransferValue(tx as any)) / 1e18
      : tokenValue;

    const handleGoTxDetails = () => {
      navigate('/home/details', {
        state: { id: null, hash: tx[txId] },
      });
    };

    return (
      <div className="flex flex-col w-full border-b border-dashed border-bkg-deepBlue">
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
                {Number(finalTxValue).toFixed(4)}
                {getTokenSymbol(isErc20Tx, coinsList, tx)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal">
                ${getFiatAmount(+tx?.value / 1e18, 6)}
              </div>
            </div>
            <div className="m-auto">
              {isConfirmed || isTxCanceled ? (
                <img
                  className="cursor-pointer transition-all hover:opacity-60"
                  src="/assets/icons/detailArrow.svg"
                  onClick={handleGoTxDetails}
                />
              ) : (
                getTxOptions(isTxCanceled, isConfirmed, tx)
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }, []);

  useEffect(() => {
    const grouped = {};

    filteredTransactions.forEach((tx) => {
      const formattedDate = formatTimeStamp(tx?.timestamp);
      if (!grouped[formattedDate]) {
        grouped[formattedDate] = [];
      }
      grouped[formattedDate].push(tx);
    });

    setGroupedTransactions(grouped);
  }, [filteredTransactions]);

  useEffect(() => {
    if (!currentAccount.transactions.ethereum?.[chainId]) {
      return;
    }
    const lastIndex = currentAccount.transactions.ethereum[chainId].length - 1;
    const lastTx = currentAccount.transactions.ethereum[chainId][
      lastIndex
    ] as IEvmTransaction;
    if (isLastTxConfirmed?.[chainId]) {
      return;
    }
    if (lastTx?.confirmations === 0) {
      controllerEmitter(['wallet', 'setIsLastTxConfirmed'], [chainId, false]);
      return;
    }
    if (lastTx?.confirmations > 0 && !isLastTxConfirmed?.[chainId]) {
      setShowModal(true);
      controllerEmitter(['wallet', 'setIsLastTxConfirmed'], [chainId, true]);
    }
  }, [currentAccount]);

  return (
    <>
      <StatusModal
        status="success"
        title="Transaction concluded!"
        description="Your transaction was successfully concluded, check on explorer!"
        show={showModal}
        onClose={() => setShowModal(false)}
      />
      <ConfirmationModal show={isOpenModal} {...modalData} />
      {Object?.entries(groupedTransactions)?.map(
        ([date, transactions]: any) => (
          <div key={date} className="relative mb-[20px]">
            <div className="text-xs text-white font-normal">{date}</div>
            {transactions?.map((tx) => (
              <EvmTransactionsListComponent key={tx?.hash} tx={tx} />
            ))}
          </div>
        )
      )}
    </>
  );
};
