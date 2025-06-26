import React, { useCallback, useEffect, useState, useRef } from 'react';
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

  const [modalData, setModalData] = useState<modalDataType>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);
  const [groupedTransactions, setGroupedTransactions] = useState<{
    [date: string]: ITransactionInfoEvm[];
  }>({});
  // Track the previous confirmation state locally
  const prevConfirmationState = useRef<{ [txHash: string]: number }>({});
  const isFirstRender = useRef(true);
  const lastToastTime = useRef<number>(0);

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

  // Create a stable dependency by tracking only transaction count and confirmation sum
  const ethereumTxs = currentAccountTransactions?.ethereum?.[chainId] || [];
  const txCount = ethereumTxs.length;
  const confirmationSum = ethereumTxs.reduce(
    (sum: number, tx: any) => sum + (tx.confirmations || 0),
    0
  );

  useEffect(() => {
    // Get the specific transactions for this chain
    const ethereumTransactions =
      currentAccountTransactions?.ethereum?.[chainId];

    if (!ethereumTransactions || !Array.isArray(ethereumTransactions)) {
      return;
    }

    // Track confirmation changes for all transactions
    const newConfirmationStates: { [txHash: string]: number } = {};
    let hasNewlyConfirmedTx = false;

    // Skip showing toast on first render
    const shouldCheckForNewConfirmations = !isFirstRender.current;

    ethereumTransactions.forEach((tx: any) => {
      const txHash = tx.hash;
      const currentConfirmations = tx.confirmations || 0;

      newConfirmationStates[txHash] = currentConfirmations;

      // Check if this transaction just went from pending (0) to confirmed (>0)
      if (
        shouldCheckForNewConfirmations &&
        prevConfirmationState.current[txHash] === 0 &&
        currentConfirmations > 0
      ) {
        hasNewlyConfirmedTx = true;
      }
    });

    // Show toast if we detected a newly confirmed transaction
    if (hasNewlyConfirmedTx) {
      const now = Date.now();
      // Prevent showing multiple toasts within 3 seconds
      if (now - lastToastTime.current > 3000) {
        // Defer toast to next tick to avoid conflicts with re-renders
        setTimeout(() => {
          alert.removeAll();
          alert.success(t('send.txSuccessfull'), {
            autoClose: 5000, // Show for 5 seconds
          });
        }, 0);
        lastToastTime.current = now;
      }
    }

    // Update the previous state for next comparison
    prevConfirmationState.current = newConfirmationStates;

    // Mark that first render is complete
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
  }, [txCount, confirmationSum, chainId, alert, t]);

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
