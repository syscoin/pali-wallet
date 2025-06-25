import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { ConfirmationModal } from 'components/Modal';
import { TransactionOptions } from 'components/TransactionOptions';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
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
  const { t } = useTranslation();
  const { alert } = useUtils();
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const isLastTxConfirmed = useSelector(
    (state: RootState) => state.vault.isLastTxConfirmed
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );
  const coinsList = useSelector(
    (state: RootState) => state.vaultGlobal.coinsList
  );

  const { chainId, currency } = activeNetwork;

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
  const [groupedTransactions, setGroupedTransactions] = useState<{
    [date: string]: ITransactionInfoEvm[];
  }>({});

  const currentAccountTransactions =
    accountTransactions[activeAccount.type]?.[activeAccount.id];
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];

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
    [handleUpdateTransaction, alert, chainId, setIsOpenModal, setModalData, t]
  );

  const EvmTransactionsListComponent = useCallback(
    ({ tx }) => {
      const isTxCanceled = tx?.isCanceled === true;
      const isConfirmed = tx?.confirmations > 0;
      const isErc20Tx = isERC20Transfer(tx as any);
      const isTxSent =
        tx?.from?.toLowerCase() === currentAccount?.address?.toLowerCase();
      const tokenValue = (() => {
        if (typeof tx?.value === 'string') {
          // Check if it's hex (starts with 0x)
          if (tx.value.startsWith('0x')) {
            return parseInt(tx.value, 16) / 1e18;
          }
          // Otherwise it's a decimal string
          return Number(tx.value) / 1e18;
        } else if (tx?.value?.hex) {
          return parseInt(tx.value.hex, 16) / 1e18;
        } else if (tx?.value?._hex) {
          return parseInt(tx.value._hex, 16) / 1e18;
        } else if (typeof tx?.value === 'number') {
          return tx.value / 1e18;
        }
        return 0;
      })();
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
                  {getTokenSymbol(isErc20Tx, coinsList, tx, currency)}
                </div>
                <div className="text-brand-gray200 text-xs font-normal">
                  {getFiatAmount(finalTxValue, 6)}
                </div>
              </div>
              <div className="m-auto">
                {isConfirmed || isTxCanceled ? (
                  <DetailArrowSvg
                    className="cursor-pointer transition-all hover:opacity-60"
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
    },
    [
      currentAccount,
      getTxStatusIcons,
      getTxType,
      getTxStatus,
      getTokenSymbol,
      coinsList,
      getFiatAmount,
      navigate,
      txId,
      getTxOptions,
    ]
  );

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
    if (!currentAccountTransactions?.ethereum?.[chainId]) {
      return;
    }
    const lastIndex = currentAccountTransactions.ethereum[chainId].length - 1;
    const lastTx = currentAccountTransactions.ethereum[chainId][lastIndex];

    // Check if isLastTxConfirmed exists for this chainId (to avoid showing on fresh pull)
    const hasExistingState = isLastTxConfirmed?.[chainId] !== undefined;

    if (isLastTxConfirmed?.[chainId]) {
      return;
    }

    if (lastTx?.confirmations === 0) {
      controllerEmitter(['wallet', 'setIsLastTxConfirmed'], [chainId, false]);
      return;
    }

    // Only show toast if we had a pending transaction that just confirmed
    // (hasExistingState === true means this isn't a fresh pull)
    if (
      lastTx?.confirmations > 0 &&
      hasExistingState &&
      !isLastTxConfirmed?.[chainId]
    ) {
      // Show toast instead of modal
      alert.removeAll();
      alert.success(t('send.txSuccessfull'));
      controllerEmitter(['wallet', 'setIsLastTxConfirmed'], [chainId, true]);
    }
  }, [currentAccountTransactions, alert, t, chainId, isLastTxConfirmed]);

  return (
    <>
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
