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
import { isTransactionInBlock } from 'utils/transactionUtils';

// Memoized transaction item component to prevent re-renders when other transactions update
const EvmTransactionItem = React.memo(
  ({
    tx,
    currentAccount,
    getTxStatusIcons,
    getTxType,
    getTxStatus,
    getTokenSymbol,
    currency,
    getFiatAmount,
    navigate,
    txId,
    getTxOptions,
    t,
    tokenSymbolCache,
  }: {
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
    tokenSymbolCache: Map<string, string>;
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
    const isErc20Tx = isERC20Transfer(tx as any);
    // Check if this is a native token transfer (no contract interaction)
    const isNativeTransfer = !tx?.input || tx.input === '0x';
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
                {getTokenSymbol(isErc20Tx, tx, currency, tokenSymbolCache)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal line-through">
                {isNativeTransfer
                  ? getFiatAmount(Number(finalTxValue), 6)
                  : '---'}
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
                {getTokenSymbol(isErc20Tx, tx, currency, tokenSymbolCache)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal line-through">
                {isNativeTransfer
                  ? getFiatAmount(Number(finalTxValue), 6)
                  : '---'}
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
                {getTokenSymbol(isErc20Tx, tx, currency, tokenSymbolCache)}
              </div>
              <div className="text-brand-gray200 text-xs font-normal">
                {isNativeTransfer ? getFiatAmount(finalTxValue, 6) : '---'}
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
  const accountAssets = useSelector(
    (state: RootState) => state.vault.accountAssets
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  const { chainId, currency } = activeNetwork;

  // Create token symbol cache from user's assets
  const tokenSymbolCache = useMemo(() => {
    const cache = new Map<string, string>();
    const currentAccountAssets =
      accountAssets[activeAccount.type]?.[activeAccount.id];

    if (currentAccountAssets?.ethereum) {
      currentAccountAssets.ethereum.forEach((token) => {
        if (token.contractAddress && token.tokenSymbol) {
          cache.set(token.contractAddress.toLowerCase(), token.tokenSymbol);
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
                  getTokenSymbol={getTokenSymbol}
                  currency={currency}
                  getFiatAmount={getFiatAmount}
                  navigate={navigate}
                  txId={txId}
                  getTxOptions={getTxOptions}
                  t={t}
                  tokenSymbolCache={tokenSymbolCache}
                />
              );
            })}
          </div>
        )
      )}
    </>
  );
};
