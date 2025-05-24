import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import externalLink from 'assets/icons/externalLink.svg';
import { LoadingComponent } from 'components/Loading';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';

import { EvmTransactionsList } from './components/Transactions/EVM/EvmList';
import { UtxoTransactionsList } from './components/Transactions/UTXO/UtxoList';

const SECONDS = 10000;

export const TransactionsPanel = () => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { url: networkUrl, chainId, explorer },
    isBitcoinBased,
    isLoadingTxs,
    isSwitchingAccount,
  } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const networkExplorer = useAdjustedExplorer(explorer);
  const adjustedNetworkUrl = useAdjustedExplorer(networkUrl);
  const adjustedExplorer = isBitcoinBased
    ? adjustedNetworkUrl
    : networkExplorer;

  const [internalLoading, setInternalLoading] = useState<boolean>(
    isLoadingTxs || isSwitchingAccount
  );
  const [previousTransactions, setPreviousTransactions] = useState([]);

  const transactions = useMemo(() => {
    const accountTransactions =
      accounts[activeAccount.type][activeAccount.id].transactions;

    if (isBitcoinBased) {
      if (Array.isArray(accountTransactions)) return [];
      const sysTxs = accountTransactions[TransactionsType.Syscoin][chainId];

      if (sysTxs && sysTxs.length > 0) {
        return sysTxs;
      } else {
        return [];
      }
    } else {
      if (Array.isArray(accountTransactions)) return [];
      const ethTxs = accountTransactions[TransactionsType.Ethereum][chainId];

      if (ethTxs && ethTxs.length > 0) {
        return ethTxs;
      } else {
        return [];
      }
    }
  }, [accounts, activeAccount, chainId, isBitcoinBased]);

  const hasTransactions =
    transactions.length > 0 || previousTransactions.length > 0;

  useEffect(() => {
    if (
      !isLoadingTxs &&
      transactions.length === 0 &&
      previousTransactions.length > 0
    ) {
      setPreviousTransactions(transactions);
    } else if (transactions.length > 0) {
      setPreviousTransactions(transactions);
    }
  }, [isLoadingTxs, transactions, previousTransactions]);

  const NoTransactionsComponent = () => (
    <div className="flex items-center justify-center pt-3 pb-6 text-brand-white text-sm">
      <p>{t('home.youHaveNoTxs')}</p>
    </div>
  );

  const OpenTransactionExplorer = useMemo(() => {
    const { xpub, address: userAddress } =
      accounts[activeAccount.type][activeAccount.id];

    const explorerUrl = `${adjustedExplorer}${
      isBitcoinBased ? 'xpub' : 'address'
    }/${isBitcoinBased ? xpub : userAddress}`;

    const openExplorer = () => window.open(explorerUrl, '_blank');

    return (
      <div className="flex mt-5 items-center justify-center gap-2">
        <img src={externalLink} />
        <button
          type="button"
          className="w-max underline text-sm font-normal bg-transparent border-none cursor-pointer"
          onClick={openExplorer}
        >
          {t('home.seeAllTxs')}
        </button>
      </div>
    );
  }, [networkUrl, adjustedExplorer, chainId, isBitcoinBased, activeAccount]);

  // Handle loading timeout with Chrome alarms (proper MV3 approach)
  useEffect(() => {
    const alarmName = `loading-timeout-${Date.now()}`;

    if (isLoadingTxs || isSwitchingAccount) {
      setInternalLoading(true);

      // Create alarm for 10 second timeout
      chrome.alarms.create(alarmName, { delayInMinutes: SECONDS / 60 });

      // Listen for this specific alarm
      const handleAlarm = (alarm: chrome.alarms.Alarm) => {
        if (alarm.name === alarmName) {
          try {
            setInternalLoading(false);
            console.warn('Loading timeout reached for transactions');
          } catch (error) {
            console.warn('Failed to update loading state:', error);
          }
          chrome.alarms.onAlarm.removeListener(handleAlarm);
        }
      };

      chrome.alarms.onAlarm.addListener(handleAlarm);

      return () => {
        chrome.alarms.clear(alarmName);
        chrome.alarms.onAlarm.removeListener(handleAlarm);
      };
    } else {
      setInternalLoading(false);
      // Clear any existing loading timeouts
      chrome.alarms.clear(alarmName);
    }
  }, [isLoadingTxs, isSwitchingAccount]);

  const allTransactions = useMemo(
    () => (hasTransactions ? transactions : previousTransactions),
    [hasTransactions, transactions, previousTransactions]
  );

  return (
    <>
      {internalLoading && !hasTransactions && <LoadingComponent />}
      {!internalLoading && !hasTransactions && (
        <div className="w-full mt-8 text-white bg-brand-blue600">
          <NoTransactionsComponent />
          {OpenTransactionExplorer}
          {/* <Fullscreen /> */}
        </div>
      )}

      {hasTransactions && (
        <div className="p-4 mt-8 w-full  mb-9 text-white text-base bg-brand-blue600">
          {isBitcoinBased ? (
            <UtxoTransactionsList userTransactions={allTransactions} />
          ) : (
            <EvmTransactionsList userTransactions={allTransactions} />
          )}
          {OpenTransactionExplorer}
        </div>
      )}
    </>
  );
};
