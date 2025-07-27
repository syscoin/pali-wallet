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
import { Tooltip } from 'components/Tooltip';
import { TransactionOptions } from 'components/TransactionOptions';
import { usePrice } from 'hooks/usePrice';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ITransactionInfoEvm, modalDataType } from 'types/useTransactionsInfo';
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
    tokenCache,
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
    tokenCache: Map<
      string,
      {
        decimals: number;
        isNft: boolean;
        symbol: string;
      }
    >;
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
    const isConfirmed = isTransactionInBlock(tx);
    const isTxSent =
      tx?.from?.toLowerCase() === currentAccount?.address?.toLowerCase();

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
            tokenCache,
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
    }, [cacheKey, currency, tokenCache, tx]);

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

      return (
        <div className="flex flex-col justify-end items-end">
          <div className="text-white text-xs font-normal">
            {displayInfo.isNft
              ? displayInfo.displayValue
              : displayInfo.hasUnknownDecimals
              ? `${finalSymbol} Transfer`
              : `${
                  isNaN(Number(finalTxValue))
                    ? '0.0000'
                    : Number(finalTxValue).toFixed(4)
                } ${finalSymbol}`}
          </div>
          <div className="text-brand-gray200 text-xs font-normal">
            {isNativeTransfer &&
            !displayInfo.isNft &&
            !displayInfo.hasUnknownDecimals
              ? getFiatAmount(Number(finalTxValue), 6)
              : '---'}
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
                {getTxType(tx, isTxSent)}
              </div>
              <div className="text-warning-error text-xs">
                {t('transactions.replaced')}
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
                {getTxType(tx, isTxSent)}
              </div>
              <div className="text-warning-error text-xs">
                {t('send.canceled')}
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
  const accountAssets = useSelector(
    (state: RootState) => state.vault.accountAssets
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  const { chainId, currency } = activeNetwork;

  // Create enhanced token cache from user's assets with symbol, decimals, and NFT info
  const tokenCache = useMemo(() => {
    const cache = new Map<
      string,
      {
        decimals: number;
        isNft: boolean;
        symbol: string;
      }
    >();
    const currentAccountAssets =
      accountAssets?.[activeAccount.type]?.[activeAccount.id];

    if (currentAccountAssets?.ethereum) {
      currentAccountAssets.ethereum.forEach((token) => {
        if (token.contractAddress && token.tokenSymbol) {
          cache.set(token.contractAddress.toLowerCase(), {
            symbol: token.tokenSymbol,
            decimals: Number(token.decimals) || (token.isNft ? 0 : 18),
            isNft: token.isNft || false,
          });
        }
      });
    }

    return cache;
  }, [accountAssets, activeAccount.type, activeAccount.id]);

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
  const [groupedTransactions, setGroupedTransactions] = useState<{
    [date: string]: ITransactionInfoEvm[];
  }>({});

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
                  tokenCache={tokenCache}
                />
              );
            })}
          </div>
        )
      )}
    </>
  );
};
