import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg } from 'components/Icon/Icon';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';
import {
  selectActiveAccountWithTransactions,
  selectVaultCoreData,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import type {
  ITransactionInfoEvm,
  ITransactionInfoUtxo,
} from 'types/useTransactionsInfo';

import { EvmTransactionsList } from './components/Transactions/EVM/EvmList';
import { UtxoTransactionsList } from './components/Transactions/UTXO/UtxoList';

export const TransactionsPanel = () => {
  // ✅ OPTIMIZED: Use compound selectors to reduce re-renders
  const { account: activeAccount, transactions: accountTransactions } =
    useSelector(selectActiveAccountWithTransactions);
  const { activeNetwork, isBitcoinBased, isSwitchingAccount } =
    useSelector(selectVaultCoreData);

  const { t } = useTranslation();

  // ✅ MEMOIZED: Explorer base (use explorer if set, fallback to url)
  const adjustedExplorer = useAdjustedExplorer(
    activeNetwork.explorer || activeNetwork.url
  );

  const utxoTransactions = useMemo<ITransactionInfoUtxo[]>(() => {
    if (!isBitcoinBased) {
      return [];
    }
    const sysTxs =
      accountTransactions[TransactionsType.Syscoin][activeNetwork.chainId];
    return (sysTxs || []) as unknown as ITransactionInfoUtxo[];
  }, [accountTransactions, activeNetwork.chainId, isBitcoinBased]);
  const evmTransactions = useMemo<ITransactionInfoEvm[]>(() => {
    if (isBitcoinBased) {
      return [];
    }
    const ethTxs =
      accountTransactions[TransactionsType.Ethereum][activeNetwork.chainId];
    return (ethTxs || []) as unknown as ITransactionInfoEvm[];
  }, [accountTransactions, activeNetwork.chainId, isBitcoinBased]);
  const transactions = isBitcoinBased ? utxoTransactions : evmTransactions;

  const hasTransactions = useMemo(
    () => transactions.length > 0,
    [transactions.length]
  );

  // ✅ MEMOIZED: Component definitions to prevent recreation
  const NoTransactionsComponent = useMemo(
    () => (
      <div className="flex items-center justify-center pt-3 pb-6 text-brand-white text-sm">
        <p>{t('home.youHaveNoTxs')}</p>
      </div>
    ),
    [t]
  );

  const TransactionSkeleton = useMemo(
    () => (
      <div className="p-4 mt-8 w-full mb-9 text-white text-base bg-brand-blue600">
        <div className="space-y-3">
          {[...Array(3)].map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-brand-blue500 rounded-lg"
            >
              <div className="flex items-center space-x-3">
                <SkeletonLoader width="40px" height="40px" />
                <div className="space-y-1">
                  <SkeletonLoader width="120px" height="16px" />
                  <SkeletonLoader width="80px" height="12px" />
                </div>
              </div>
              <div className="text-right space-y-1">
                <SkeletonLoader width="100px" height="16px" />
                <SkeletonLoader width="60px" height="12px" />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-brand-gray200">
          {t('networkConnection.loadingTransactions')}
        </p>
      </div>
    ),
    [t]
  );

  // ✅ OPTIMIZED: Memoized explorer component with proper dependencies
  const OpenTransactionExplorer = useMemo(() => {
    if (!activeAccount) return null;

    const { xpub, address: userAddress, isImported } = activeAccount as any;

    // Use xpub for UTXO accounts when available, including imported extended-key accounts.
    // Only fall back to /address for:
    // - EVM chains (always address)
    // - UTXO single-address imports (WIF) where xpub === address
    // - missing xpub
    const isSingleAddressUtxoImport =
      Boolean(isImported) && Boolean(xpub) && xpub === userAddress;
    const useAddressPathForUtxo =
      isBitcoinBased && (!xpub || isSingleAddressUtxoImport);
    const pathSegment = isBitcoinBased
      ? useAddressPathForUtxo
        ? 'address'
        : 'xpub'
      : 'address';
    const identifier = isBitcoinBased
      ? useAddressPathForUtxo
        ? userAddress
        : xpub
      : userAddress;

    const explorerUrl = `${adjustedExplorer}${pathSegment}/${encodeURIComponent(
      identifier
    )}`;

    const openExplorer = () => window.open(explorerUrl, '_blank');

    return (
      <div className="flex mt-5 items-center justify-center gap-2">
        <ExternalLinkSvg />
        <button
          type="button"
          className="w-max underline text-sm font-normal bg-transparent border-none cursor-pointer"
          onClick={openExplorer}
        >
          {t('home.seeAllTxs')}
        </button>
      </div>
    );
  }, [activeAccount, adjustedExplorer, isBitcoinBased, t]);

  // Show the skeleton until the first transaction fetch for this
  // account/network has settled, instead of flashing the empty state.
  // Empty fetches don't dispatch anything, so we treat either incoming
  // transactions or a completed background poll cycle as the settle signal
  // (with a short safety timeout so zero-tx accounts don't wait forever).
  const isPollingUpdate = useSelector(
    (state: RootState) => state.vaultGlobal.isPollingUpdate
  );
  const settleKey = `${(activeAccount as any)?.address ?? ''}:${
    activeNetwork.chainId
  }`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const hasSettled = settledKey === settleKey;
  const sawPollRef = useRef(false);

  useEffect(() => {
    sawPollRef.current = false;
  }, [settleKey]);

  useEffect(() => {
    if (hasTransactions) setSettledKey(settleKey);
  }, [hasTransactions, settleKey]);

  useEffect(() => {
    if (isPollingUpdate) {
      sawPollRef.current = true;
      return;
    }
    if (sawPollRef.current) setSettledKey(settleKey);
  }, [isPollingUpdate, settleKey]);

  useEffect(() => {
    if (hasSettled) return;
    // Zero-tx accounts never get a settle signal (empty fetches don't
    // dispatch), so fall through to the empty state quickly instead of
    // holding the skeleton for seconds.
    const timeout = setTimeout(() => setSettledKey(settleKey), 1200);
    return () => clearTimeout(timeout);
  }, [settleKey, hasSettled]);

  const isLoading = useMemo(
    () => isSwitchingAccount || (!hasSettled && !hasTransactions),
    [isSwitchingAccount, hasSettled, hasTransactions]
  );

  return (
    <>
      {isLoading && !hasTransactions && TransactionSkeleton}
      {!isLoading && !hasTransactions && (
        <div
          id="activity-panel-empty"
          className="w-full mt-8 text-white bg-brand-blue600"
        >
          {NoTransactionsComponent}
          {OpenTransactionExplorer}
          {/* <Fullscreen /> */}
        </div>
      )}

      {hasTransactions && (
        <div
          id="activity-panel-list"
          className="p-4 mt-8 w-full  mb-9 text-white text-base bg-brand-blue600"
        >
          {isBitcoinBased ? (
            <UtxoTransactionsList userTransactions={utxoTransactions} />
          ) : (
            <EvmTransactionsList userTransactions={evmTransactions} />
          )}
          {OpenTransactionExplorer}
        </div>
      )}
    </>
  );
};
