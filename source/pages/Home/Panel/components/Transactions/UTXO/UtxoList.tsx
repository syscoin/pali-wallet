import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';
import { ellipsis } from 'utils/index';
import { isTransactionInBlock } from 'utils/transactionUtils';

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
  const isConfirmed = isTransactionInBlock(tx);

  const handleGoTxDetails = () => {
    navigate('/home/details', {
      state: {
        id: null,
        hash: tx.txid,
      },
    });
  };

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
        <DetailArrowSvg
          className="cursor-pointer transition-all hover:opacity-60"
          onClick={handleGoTxDetails}
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
  const { t } = useTranslation();
  const { alert } = useUtils();
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  const { chainId } = activeNetwork;

  const { filteredTransactions } = useTransactionsListConfig(userTransactions);

  // Track the previous confirmation state locally
  const prevConfirmationState = useRef<{ [txid: string]: number }>({});
  const isFirstRender = useRef(true);
  const lastToastTime = useRef<number>(0);

  const currentAccountTransactions =
    accountTransactions[activeAccount.type]?.[activeAccount.id];

  const array = filteredTransactions as ITransactionInfoUtxo[];

  // Create a stable dependency by tracking only transaction count and confirmation sum
  const syscoinTxs = currentAccountTransactions?.syscoin?.[chainId] || [];
  const txCount = syscoinTxs.length;
  const confirmationSum = syscoinTxs.reduce(
    (sum: number, tx: any) => sum + (tx.confirmations || 0),
    0
  );

  useEffect(() => {
    // Get the specific transactions for this chain
    const syscoinTransactions = currentAccountTransactions?.syscoin?.[chainId];

    if (!syscoinTransactions || !Array.isArray(syscoinTransactions)) {
      return;
    }

    // Track confirmation changes for all transactions
    const newConfirmationStates: { [txid: string]: number } = {};
    let hasNewlyConfirmedTx = false;

    // Skip showing toast on first render
    const shouldCheckForNewConfirmations = !isFirstRender.current;

    syscoinTransactions.forEach((tx: any) => {
      const txId = tx.txid;
      const currentConfirmations = tx.confirmations || 0;

      newConfirmationStates[txId] = currentConfirmations;

      // Check if this transaction just went from pending (0) to confirmed (>0)
      if (
        shouldCheckForNewConfirmations &&
        prevConfirmationState.current[txId] === 0 &&
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
        alert.success(t('send.txSuccessfull'), {
          autoClose: 5000, // Show for 5 seconds
        });
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
      {array.map((tx) => (
        <UtxoTransactionsListComponent
          key={tx.txid}
          tx={tx}
          userTransactions={userTransactions}
        />
      ))}
    </>
  );
};
