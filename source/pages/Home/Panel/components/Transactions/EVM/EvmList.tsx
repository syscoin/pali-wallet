import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { ConfirmationModal } from 'components/Modal';
import { TransactionOptions } from 'components/TransactionOptions';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ITransactionInfoEvm, modalDataType } from 'types/useTransactionsInfo';
import {
  getERC20TransferValue,
  handleUpdateTransaction,
  isERC20Transfer,
} from 'utils/transactions';

// Memoized transaction item component to prevent re-renders when other transactions update
const EvmTransactionItem = React.memo(
  ({
    tx,
    currentAccount,
    getTxStatusIcons,
    getTxType,
    getTxStatus,
    getTokenSymbol,
    coinsList,
    currency,
    getFiatAmount,
    navigate,
    txId,
    getTxOptions,
    t,
  }: {
    coinsList: any;
    currency: string;
    currentAccount: any;
    getFiatAmount: any;
    getTokenSymbol: any;
    getTxOptions: any;
    getTxStatus: any;
    getTxStatusIcons: any;
    getTxType: any;
    navigate: any;
    t: any;
    tx: ITransactionInfoEvm & {
      isReplaced?: boolean;
      isSpeedUp?: boolean;
      replacesHash?: string;
    };
    txId: string;
  }) => {
    const isTxCanceled = tx?.isCanceled === true;
    const isReplaced = tx?.isReplaced === true;
    const isSpeedUp = tx?.isSpeedUp === true;
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
      } else if ((tx?.value as any)?._hex) {
        return parseInt((tx.value as any)._hex, 16) / 1e18;
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

    // If transaction is replaced, show it with a different style
    if (isReplaced) {
      return (
        <div className="flex justify-between py-2 w-full border-b border-dashed border-bkg-deepBlue opacity-50">
          <div className="flex items-center">
            {getTxStatusIcons(getTxType(tx, isTxSent), false)}
            <div className="flex flex-col">
              <div className="text-white text-xs font-normal line-through">
                {getTxType(tx, isTxSent)}
              </div>
              <div className="text-warning-error text-xs">
                {t('transactions.replaced')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col justify-end items-end">
              <div className="text-white text-xs font-normal line-through">
                {isNaN(Number(finalTxValue))
                  ? '0.0000'
                  : Number(finalTxValue).toFixed(4)}
                {getTokenSymbol(isErc20Tx, coinsList, tx, currency)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal line-through">
                {getFiatAmount(Number(finalTxValue), 6)}
              </div>
            </div>
            <div className="m-auto">
              <DetailArrowSvg
                className="cursor-pointer transition-all hover:opacity-60"
                onClick={handleGoTxDetails}
              />
            </div>
          </div>
        </div>
      );
    }

    // If transaction is canceled, show it with a different style
    if (isTxCanceled) {
      return (
        <div className="flex justify-between py-2 w-full border-b border-dashed border-bkg-deepBlue opacity-30">
          <div className="flex items-center">
            {getTxStatusIcons(getTxType(tx, isTxSent), false)}
            <div className="flex flex-col">
              <div className="text-white text-xs font-normal line-through">
                {getTxType(tx, isTxSent)}
              </div>
              <div className="text-warning-error text-xs">
                {t('send.canceled')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col justify-end items-end">
              <div className="text-white text-xs font-normal line-through">
                {isNaN(Number(finalTxValue))
                  ? '0.0000'
                  : Number(finalTxValue).toFixed(4)}
                {getTokenSymbol(isErc20Tx, coinsList, tx, currency)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal line-through">
                {getFiatAmount(Number(finalTxValue), 6)}
              </div>
            </div>
            <div className="m-auto">
              <DetailArrowSvg
                className="cursor-pointer transition-all hover:opacity-60"
                onClick={handleGoTxDetails}
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col w-full border-b border-dashed border-bkg-deepBlue">
        <div className="flex justify-between py-2 w-full">
          <div className="flex items-center">
            {getTxStatusIcons(getTxType(tx, isTxSent), false)}
            <div className="flex flex-col ">
              <div className="text-white text-xs font-normal">
                {getTxType(tx, isTxSent)}
                {isSpeedUp && (
                  <span className="text-warning-success ml-1">
                    ({t('header.speedUp')})
                  </span>
                )}
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
              {isConfirmed || isTxCanceled || isReplaced ? (
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
        {tx.replacesHash && (
          <div className="text-xs text-brand-gray200 pb-1">
            {t('transactions.replaces')}: {tx.replacesHash.slice(0, 10)}...
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    // Custom comparison function - only re-render if the transaction data actually changed
    prevProps.tx.hash === nextProps.tx.hash &&
    prevProps.tx.confirmations === nextProps.tx.confirmations &&
    prevProps.tx.isCanceled === nextProps.tx.isCanceled &&
    (prevProps.tx as any).isReplaced === (nextProps.tx as any).isReplaced &&
    (prevProps.tx as any).isSpeedUp === (nextProps.tx as any).isSpeedUp &&
    prevProps.tx.value === nextProps.tx.value &&
    prevProps.currentAccount?.address === nextProps.currentAccount?.address
);

EvmTransactionItem.displayName = 'EvmTransactionItem';

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

  const [modalData, setModalData] = useState<modalDataType>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [groupedTransactions, setGroupedTransactions] = useState<{
    [date: string]: ITransactionInfoEvm[];
  }>({});

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
    [alert, chainId]
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
  }, [filteredTransactions, formatTimeStamp]);

  return (
    <>
      <ConfirmationModal show={isOpenModal} {...modalData} />
      {Object?.entries(groupedTransactions)?.map(
        ([date, transactions]: any) => (
          <div key={date} className="relative mb-[20px]">
            <div className="text-xs text-white font-normal">{date}</div>
            {transactions?.map((tx) => (
              <EvmTransactionItem
                key={tx?.hash}
                tx={tx}
                currentAccount={currentAccount}
                getTxStatusIcons={getTxStatusIcons}
                getTxType={getTxType}
                getTxStatus={getTxStatus}
                getTokenSymbol={getTokenSymbol}
                coinsList={coinsList}
                currency={currency}
                getFiatAmount={getFiatAmount}
                navigate={navigate}
                txId={txId}
                getTxOptions={getTxOptions}
                t={t}
              />
            ))}
          </div>
        )
      )}
    </>
  );
};
