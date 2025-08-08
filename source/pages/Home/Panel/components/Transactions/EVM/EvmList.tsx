import React, {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { ConfirmationModal } from 'components/Modal';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { TransactionOptions } from 'components/TransactionOptions';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { ITransactionInfoEvm, modalDataType } from 'types/useTransactionsInfo';
import {
  isContractInteraction,
  getTransactionTypeLabel,
  getTransactionTypeDisplayLabel,
} from 'utils/commonMethodSignatures';
import { getTokenLogo } from 'utils/index';
import {
  getTransactionDisplayInfo,
  handleUpdateTransaction,
} from 'utils/transactions';
import { isTransactionInBlock } from 'utils/transactionUtils';

// Skeleton loader component for transaction values
const TransactionValueSkeleton = () => (
  <div className="animate-pulse">
    <div className="h-3 bg-bkg-3 rounded w-20 mb-1"></div>
    <div className="h-3 bg-bkg-3 rounded w-16"></div>
  </div>
);

// Memoized transaction item component to prevent re-renders when other transactions update
const EvmTransactionItem = React.memo(
  ({
    tx,
    currentAccount,
    getTxStatusIcons,
    getTxType,
    getTxStatus,
    currency,
    getFiatAmount,
    navigate,
    txId,
    getTxOptions,
    t,
  }: {
    currency: string;
    currentAccount: any;
    getFiatAmount: any;
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
    const activeAssets = useSelector(selectActiveAccountAssets);
    const isTxCanceled = tx?.isCanceled === true;
    const isReplaced = tx?.isReplaced === true;
    const isSpeedUp = tx?.isSpeedUp === true;
    const isConfirmed = isTransactionInBlock(tx);
    const isTxSent =
      tx?.from?.toLowerCase() === currentAccount?.address?.toLowerCase();
    const isContractCall = isContractInteraction(tx);
    // Check transaction status from API
    // txreceipt_status: '0' = failed, '1' = success, null/undefined = pending
    const isFailed = tx.txreceipt_status === '0' || tx.isError === '1';

    // Add loading state
    const [isLoadingDisplayInfo, setIsLoadingDisplayInfo] =
      React.useState(true);
    const [displayInfo, setDisplayInfo] = React.useState<{
      actualRecipient: string;
      displaySymbol: string;
      displayValue: number | string;
      hasUnknownDecimals?: boolean;
      isErc20Transfer: boolean;
      isNft: boolean;
      tokenId?: string;
    }>({
      displayValue: 0,
      displaySymbol: currency.toUpperCase(),
      isErc20Transfer: false,
      actualRecipient: '',
      isNft: false,
    });

    // Create a stable cache key for memoization
    const cacheKey = useMemo(
      () => `${tx.hash}-${tx.value}-${tx.to}-${tx.input}`,
      [tx.hash, tx.value, tx.to, tx.input]
    );

    // Effect to get proper transaction display info
    React.useEffect(() => {
      let cancelled = false;

      const getDisplayInfo = async () => {
        setIsLoadingDisplayInfo(true);
        try {
          const info = await getTransactionDisplayInfo(
            tx,
            currency,
            true // Skip fetching unknown tokens in transaction list
          );
          if (!cancelled) {
            setDisplayInfo(info);
            setIsLoadingDisplayInfo(false);
          }
        } catch (error) {
          console.error('Error getting transaction display info:', error);
          if (!cancelled) {
            setIsLoadingDisplayInfo(false);
          }
        }
      };

      getDisplayInfo();

      return () => {
        cancelled = true;
      };
    }, [cacheKey, currency, tx]);

    const finalTxValue = displayInfo.displayValue;
    const finalSymbol = displayInfo.displaySymbol;
    const isErc20Tx = displayInfo.isErc20Transfer;
    // Check if this is a native token transfer (no contract interaction)
    const isNativeTransfer = !isErc20Tx;

    const handleGoTxDetails = () => {
      navigate('/home/details', {
        state: { id: null, hash: tx[txId] },
      });
    };

    // Render value display with loading state
    const renderValueDisplay = () => {
      if (isLoadingDisplayInfo) {
        return <TransactionValueSkeleton />;
      }

      const showFiat =
        isNativeTransfer &&
        !displayInfo.isNft &&
        !displayInfo.hasUnknownDecimals;
      const fiatText = showFiat
        ? getFiatAmount(Number(finalTxValue), 6)
        : '---';
      const isNumericAmount =
        !isNaN(Number(finalTxValue)) && Number(finalTxValue) > 0;
      // Show sign for native (when we also show fiat) and for ERC-20 transfers as well
      const showSign =
        isNumericAmount && (showFiat || displayInfo.isErc20Transfer);

      const amountStr = displayInfo.hasUnknownDecimals
        ? `${finalSymbol} Transfer`
        : displayInfo.isNft && displayInfo.tokenId
        ? `${Number(finalTxValue)} ${finalSymbol} #${
            displayInfo.tokenId.length > 8
              ? displayInfo.tokenId.substring(0, 6) + '...'
              : displayInfo.tokenId
          }`
        : `${
            isNaN(Number(finalTxValue))
              ? '0.0000'
              : displayInfo.isNft
              ? Number(finalTxValue)
              : Number(finalTxValue).toFixed(4)
          } ${finalSymbol}`;

      // Resolve token icon for imported ERC-20s (no fetches; skip if absent)
      let tokenIcon: React.ReactNode = null;
      if (displayInfo.isErc20Transfer && tx.to && activeAssets?.ethereum) {
        const imported = activeAssets.ethereum.find(
          (a: any) =>
            a?.contractAddress?.toLowerCase() === tx?.to?.toLowerCase()
        ) as any;
        if (imported) {
          const logo = imported.logo || getTokenLogo(imported.tokenSymbol);
          if (logo) {
            tokenIcon = (
              <TokenIcon
                logo={logo}
                assetGuid={imported.contractAddress}
                symbol={imported.tokenSymbol}
                size={14}
                className="shrink-0"
              />
            );
          }
        }
      }

      return (
        <div className="flex flex-col justify-end items-end">
          <div className="text-white text-xs font-normal whitespace-nowrap">
            {showSign && (
              <span
                className={`${
                  isTxSent ? 'text-warning-error' : 'text-brand-green'
                }`}
              >
                {isTxSent ? '-' : '+'}
              </span>
            )}
            {tokenIcon && (
              <span className="ml-1 align-middle inline-flex items-center">
                {tokenIcon}
              </span>
            )}
            <span className="ml-1 align-middle">{amountStr}</span>
          </div>
          <div className="text-brand-gray200 text-xs font-normal whitespace-nowrap">
            {fiatText === '---' ? '---' : fiatText}
          </div>
          {displayInfo.hasUnknownDecimals && (
            <div className="text-warning-error text-[10px]">
              {t('transactions.unknownDecimals')}
            </div>
          )}
        </div>
      );
    };

    // If transaction is replaced, show it with a different style
    if (isReplaced) {
      return (
        <div className="flex justify-between py-2 w-full border-b border-dashed border-bkg-deepBlue opacity-50">
          <div className="flex items-center">
            {getTxStatusIcons(getTxType(tx, isTxSent), false)}
            <div className="flex flex-col">
              <div className="text-white text-xs font-normal line-through">
                {getTransactionTypeDisplayLabel(
                  getTransactionTypeLabel(tx, isTxSent),
                  t,
                  currency
                )}
              </div>
              <div className="text-warning-error text-xs">
                {isFailed ? t('send.failed') : t('transactions.replaced')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="line-through opacity-50">
              {renderValueDisplay()}
            </div>
            <div className="m-auto">
              <Tooltip content={t('notifications.clickToView')}>
                <DetailArrowSvg
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:opacity-80"
                  onClick={handleGoTxDetails}
                />
              </Tooltip>
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
                {getTransactionTypeDisplayLabel(
                  getTransactionTypeLabel(tx, isTxSent),
                  t,
                  currency
                )}
              </div>
              <div className="text-warning-error text-xs">
                {isFailed ? t('send.failed') : t('send.canceled')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="line-through opacity-50">
              {renderValueDisplay()}
            </div>
            <div className="m-auto">
              <Tooltip content={t('notifications.clickToView')}>
                <DetailArrowSvg
                  className="cursor-pointer transition-all duration-200 hover:scale-110 hover:opacity-80"
                  onClick={handleGoTxDetails}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col w-full border-b border-dashed border-bkg-deepBlue">
        <div className="flex justify-between py-2 w-full">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 pt-0.5">
              {getTxStatusIcons(getTxType(tx, isTxSent), false)}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white text-xs font-normal">
                  {getTransactionTypeDisplayLabel(
                    getTransactionTypeLabel(tx, isTxSent),
                    t,
                    currency
                  )}
                </span>
                {isContractCall && tx.to && (
                  <Tooltip
                    content={
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-white">
                          Contract Address
                        </span>
                        <span className="text-xs font-mono text-brand-gray300">
                          {tx.to}
                        </span>
                      </div>
                    }
                  >
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-blue/10 border border-brand-blue/20 cursor-pointer transition-all duration-200 hover:bg-brand-blue/20 hover:border-brand-blue/30 hover:scale-105 whitespace-nowrap">
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="text-brand-blue"
                      >
                        <path
                          d="M2 4.5A2.5 2.5 0 014.5 2h7A2.5 2.5 0 0114 4.5v7a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 012 11.5v-7z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M5 7h6M5 9h4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="text-brand-blue text-[10px] font-medium">
                        Contract
                      </span>
                    </span>
                  </Tooltip>
                )}
                {isSpeedUp && (
                  <span className="text-warning-success ml-1 text-xs">
                    ({t('header.speedUp')})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                {isFailed && isConfirmed ? (
                  <p className="text-xs font-normal text-warning-error">
                    {t('send.failed')}
                  </p>
                ) : (
                  getTxStatus(isTxCanceled, isConfirmed)
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {renderValueDisplay()}
            <div className="m-auto">
              {isConfirmed || isTxCanceled || isReplaced ? (
                <Tooltip content={t('notifications.clickToView')}>
                  <DetailArrowSvg
                    className="cursor-pointer transition-all duration-200 hover:scale-110 hover:opacity-80"
                    onClick={handleGoTxDetails}
                  />
                </Tooltip>
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

  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  const { chainId, currency } = activeNetwork;

  const {
    filteredTransactions,
    formatTimeStamp,
    getTxStatusIcons,
    getTxStatus,
    getTxType,
    txId,
  } = useTransactionsListConfig(userTransactions);
  const { navigate } = useUtils();
  const { getFiatAmount } = usePrice();

  const [modalData, setModalData] = useState<modalDataType>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);

  // Track the previous confirmation state locally (like UTXO implementation)
  const prevConfirmationState = useRef<{ [hash: string]: number }>({});
  const isFirstRender = useRef(true);
  const lastToastTime = useRef<number>(0);

  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  const currentAccountTransactions =
    accountTransactions[activeAccount.type]?.[activeAccount.id];

  // Create a stable dependency by tracking only transaction count and confirmation sum
  const ethereumTxs = currentAccountTransactions?.ethereum?.[chainId] || [];
  const txCount = ethereumTxs.length;
  const confirmationSum = ethereumTxs.reduce(
    (sum: number, tx: any) => sum + (tx.confirmations || 0),
    0
  );

  // Add reactive confirmation tracking (like UTXO implementation)
  useEffect(() => {
    // Get the specific transactions for this chain
    const ethereumTransactions =
      currentAccountTransactions?.ethereum?.[chainId];

    if (!ethereumTransactions || !Array.isArray(ethereumTransactions)) {
      return;
    }

    // Track confirmation changes for all transactions
    const newConfirmationStates: { [hash: string]: number } = {};
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
  }, [txCount, confirmationSum, chainId, alert, t, currentAccountTransactions]);

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

  // Memoize grouped transactions
  const groupedTransactions = useMemo(() => {
    const grouped: { [date: string]: ITransactionInfoEvm[] } = {};

    filteredTransactions.forEach((tx) => {
      const formattedDate = formatTimeStamp(tx?.timestamp);
      if (!grouped[formattedDate]) {
        grouped[formattedDate] = [];
      }
      grouped[formattedDate].push(tx);
    });

    return grouped;
  }, [filteredTransactions, formatTimeStamp]);

  return (
    <>
      <ConfirmationModal show={isOpenModal} {...modalData} />
      {Object?.entries(groupedTransactions)?.map(
        ([date, transactions]: any) => (
          <div key={date} className="relative mb-[20px]">
            <div className="text-xs text-white font-normal">{date}</div>
            {transactions?.map((tx, index) => {
              // Create a unique key that handles replacements properly
              // Use nonce if available (EVM), otherwise use hash/txid
              const txKey =
                tx.nonce !== undefined
                  ? `nonce-${tx.nonce}-${tx?.hash || `unknown-${index}`}`
                  : `${tx?.hash || tx?.txid || `unknown-${index}`}-${index}`;

              return (
                <EvmTransactionItem
                  key={txKey}
                  tx={tx}
                  currentAccount={currentAccount}
                  getTxStatusIcons={getTxStatusIcons}
                  getTxType={getTxType}
                  getTxStatus={getTxStatus}
                  currency={currency}
                  getFiatAmount={getFiatAmount}
                  navigate={navigate}
                  txId={txId}
                  getTxOptions={getTxOptions}
                  t={t}
                />
              );
            })}
          </div>
        )
      )}
    </>
  );
};
