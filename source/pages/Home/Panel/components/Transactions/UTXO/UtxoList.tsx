import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { Icon } from 'components/Icon';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';
import { ellipsis } from 'utils/index';
import { getSyscoinTransactionTypeStyle } from 'utils/syscoinTransactionUtils';
import { isTransactionInBlock } from 'utils/transactionUtils';

export const UtxoTransactionsListComponent = ({
  userTransactions,
  tx,
}: {
  tx: ITransactionInfoUtxo;
  userTransactions: ITransactionInfoUtxo[];
}) => {
  const { navigate, useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const [, copy] = useCopyClipboard();
  const { getTxStatus, formatTimeStampUtxo, blocktime } =
    useTransactionsListConfig(userTransactions);

  const isTxCanceled = tx?.isCanceled === true;
  const isConfirmed = isTransactionInBlock(tx);

  // Get SPT transaction styling - always returns a style (has default fallback)
  const sptInfo = getSyscoinTransactionTypeStyle(tx.tokenType);

  const handleGoTxDetails = () => {
    navigate('/home/details', {
      state: {
        id: null,
        hash: tx.txid,
      },
    });
  };

  const handleCopyTxId = () => {
    copy(tx.txid);
    alert.success(t('home.hashCopied'));
  };

  return (
    <div className="flex py-2 w-full border-b border-dashed border-bkg-deepBlue hover:bg-alpha-whiteAlpha50 transition-colors duration-200 rounded-lg">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <p className="text-xs font-mono">{ellipsis(tx.txid, 4, 14)}</p>
          <Tooltip content={t('buttons.copy')}>
            <IconButton
              className="p-0.5 hover:bg-brand-royalbluemedium/20 rounded transition-all duration-200"
              onClick={handleCopyTxId}
            >
              <Icon
                name="Copy"
                className="w-3 h-3 text-brand-gray400 hover:text-brand-royalblue"
              />
            </IconButton>
          </Tooltip>
        </div>
        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
      </div>

      <div className="flex flex-[0.8] flex-col gap-1">
        {formatTimeStampUtxo(tx[blocktime] * 1000)}
        <div
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full max-w-fit transition-all duration-200 hover:scale-105 hover:brightness-110 cursor-default"
          style={sptInfo.bgStyle}
        >
          <span className="text-xs">{sptInfo.icon}</span>
          <span className="text-xs font-medium text-white">
            {sptInfo.label}
          </span>
        </div>
      </div>

      <div>
        <Tooltip content={t('notifications.clickToView')}>
          <DetailArrowSvg
            className="cursor-pointer transition-all duration-200 hover:scale-110 hover:opacity-80"
            onClick={handleGoTxDetails}
          />
        </Tooltip>
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
