import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { EnhancedEvmTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import {
  TransactionHeader,
  TransactionDetailsList,
  TransactionEventLogs,
  DecodedTransactionParams,
} from 'components/TransactionDetails';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import type { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { IDecodedTx } from 'types/transactions';
import { formatMethodName } from 'utils/commonMethodSignatures';
import { camelCaseToText } from 'utils/index';
import { getTransactionDisplayInfo } from 'utils/transactions';
import { isTransactionInBlock } from 'utils/transactionUtils';

// Transaction details cache with TTL (5 minutes)
const txDetailsCache = new Map<string, { data: any; timestamp: number }>();
const decodedTxCache = new Map<
  string,
  { data: IDecodedTx | null; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const EvmTransactionDetailsEnhanced = ({ hash }: { hash: string }) => {
  const { controllerEmitter } = useController();
  const {
    activeNetwork: { chainId, currency, apiUrl },
    activeAccount,
    accountAssets,
  } = useSelector((state: RootState) => state.vault);

  // Use proper selectors
  const currentAccount = useSelector(selectActiveAccount);
  const accountTransactions = useSelector(selectActiveAccountTransactions);

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
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

  const { getTxStatusIcons, getTxStatus, getTxType } =
    useTransactionsListConfig();

  const [, copy] = useCopyClipboard();
  const [enhancedDetails, setEnhancedDetails] = useState<any>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [decodedTxData, setDecodedTxData] = useState<IDecodedTx | null>(null);

  // Simple duplicate prevention (like EvmAssetDetails pattern)
  const fetchingRef = useRef(false);
  const decodingRef = useRef(false);

  // State for transaction display info - moved up to be available for useEffect dependencies
  const [transactionDisplayInfo, setTransactionDisplayInfo] = useState<{
    actualRecipient: string;
    displaySymbol: string;
    displayValue: number | string;
    isErc20Transfer: boolean;
    isNft: boolean;
    tokenId?: string;
  } | null>(null);

  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;

  // Helper function to get appropriate copy message based on field label
  const getCopyMessage = (label: string) => {
    switch (label.toLowerCase()) {
      case 'from':
      case 'to':
        return t('home.addressCopied');
      case 'hash':
      case 'block hash':
      case 'txid':
      case 'transaction id':
        return t('home.hashCopied');
      case 'input': // Hex data
        return t('send.hexDataCopied');
      case 'method':
      case 'function':
      case 'action':
      case 'revert reason':
      case 'success':
      case 'value':
      case 'confirmations':
      case 'timestamp':
      case 'block time':
      case 'gas used':
      case 'gas price':
      case 'max fee per gas':
      case 'max priority fee per gas':
      case 'nonce':
      case 'fees':
      case 'gas limit':
      case 'block number':
        return t('settings.successfullyCopied');
      default:
        return t('settings.successfullyCopied'); // Generic fallback
    }
  };

  // Copy message is now handled inline in the copy button onClick

  // Fetch enhanced transaction details using controller methods (handles both API and provider)
  useEffect(() => {
    const fetchEnhancedDetails = async () => {
      if (!hash) return;

      // Check cache first
      const cached = txDetailsCache.get(hash);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setEnhancedDetails(cached.data);
        return;
      }

      // Prevent duplicate fetches
      if (fetchingRef.current) return;

      fetchingRef.current = true;
      setIsLoadingDetails(true);
      try {
        let enhancedData = null;

        if (apiUrl) {
          // Use API method for networks with API URL (faster, but may miss some EIP-1559 fields)
          enhancedData = await controllerEmitter(
            ['wallet', 'getEvmTransactionFromAPI'],
            [hash, apiUrl]
          );
        } else {
          // Use provider method for networks without API URL (slower, but complete)
          enhancedData = await controllerEmitter(
            ['wallet', 'getEvmTransactionFromProvider'],
            [hash]
          );
        }

        if (enhancedData) {
          // Cache the result
          txDetailsCache.set(hash, {
            data: enhancedData,
            timestamp: Date.now(),
          });
          setEnhancedDetails(enhancedData);
        } else {
          setEnhancedDetails(null);
        }
      } catch (error) {
        console.error('Failed to fetch enhanced transaction details:', error);
        // On error, set to null to fall back to basic data
        setEnhancedDetails(null);
      } finally {
        fetchingRef.current = false;
        setIsLoadingDetails(false);
      }
    };

    fetchEnhancedDetails();

    // Cleanup function to reset fetch state
    return () => {
      fetchingRef.current = false;
    };
  }, [hash, apiUrl]);

  // Effect to decode transaction data when we have transaction data
  useEffect(() => {
    const processTransactionDecoding = async () => {
      // Check cache first
      const cached = decodedTxCache.get(hash);
      const now = Date.now();

      if (cached && now - cached.timestamp < CACHE_TTL) {
        setDecodedTxData(cached.data);
        return;
      }

      const ethereumTransactions = accountTransactions[
        TransactionsType.Ethereum
      ][chainId] as IEvmTransaction[];

      const currentTransaction = ethereumTransactions?.find(
        (tx: any) => tx.hash === hash
      );

      if (currentTransaction && !decodingRef.current) {
        decodingRef.current = true;

        try {
          const mergedTx = enhancedDetails
            ? { ...currentTransaction, ...enhancedDetails }
            : currentTransaction;

          let decodedData: IDecodedTx | null = null;

          // Always decode transactions with input data to get full parameter details
          // This ensures we show decoded data even if transactionDisplayInfo isn't ready yet
          if (!mergedTx.input || mergedTx.input === '0x') {
            // Simple ETH transfers with no input data
            decodedData = {
              method: 'Send',
              types: [],
              inputs: [],
              names: [],
            };
          } else {
            // Always decode transactions with input data to get full details
            try {
              decodedData = (await controllerEmitter(
                ['wallet', 'decodeEvmTransactionData'],
                [mergedTx]
              )) as IDecodedTx;
            } catch (decodeError) {
              console.error('Failed to decode transaction data:', decodeError);
              // Fallback based on what we know
              if (transactionDisplayInfo?.isErc20Transfer) {
                decodedData = {
                  method: transactionDisplayInfo.isNft
                    ? 'NFT Transfer'
                    : 'Token Transfer',
                  types: [],
                  inputs: [],
                  names: [],
                };
              }
            }
          }

          // Cache the result
          decodedTxCache.set(hash, {
            data: decodedData,
            timestamp: now,
          });

          setDecodedTxData(decodedData);
        } catch (error) {
          console.error('Error decoding transaction:', error);
          setDecodedTxData(null);
        } finally {
          decodingRef.current = false;
        }
      }
    };

    if (hash && accountTransactions[TransactionsType.Ethereum][chainId]) {
      processTransactionDecoding();
    }
  }, [
    hash,
    chainId,
    accountTransactions,
    enhancedDetails,
    transactionDisplayInfo,
    // controllerEmitter is omitted as it's a stable reference from useController
  ]);

  const formattedTransaction = [];

  const ethereumTransactions = accountTransactions[TransactionsType.Ethereum][
    chainId
  ] as IEvmTransaction[];

  // Effect to get proper transaction display info
  useEffect(() => {
    const getDisplayInfo = async () => {
      const currentTransaction = ethereumTransactions?.find(
        (tx: any) => tx.hash === hash
      );

      if (currentTransaction) {
        const mergedTx = enhancedDetails
          ? { ...currentTransaction, ...enhancedDetails }
          : currentTransaction;
        const displayInfo = await getTransactionDisplayInfo(
          mergedTx,
          currency,
          tokenCache
          // Don't skip token fetch on details page - users want full info
        );
        setTransactionDisplayInfo(displayInfo);
      }
    };

    if (ethereumTransactions && hash) {
      getDisplayInfo();
    }
  }, [ethereumTransactions, hash, enhancedDetails, currency, tokenCache]);

  ethereumTransactions?.forEach((transaction: any) => {
    const tx = { ...transaction };

    tx.value = !!tx.value?.hex ? tx.value?.hex : tx.value;

    if (tx?.hash !== hash) return null;
    transactionTx = tx;

    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = isTransactionInBlock(tx);
    isTxSent = tx.from.toLowerCase() === currentAccount?.address?.toLowerCase();

    // Merge with enhanced details if available - prioritize enhanced data
    const mergedTx = enhancedDetails ? { ...tx, ...enhancedDetails } : tx;

    // Use the decoded transaction data for method information
    if (decodedTxData && decodedTxData.method) {
      mergedTx.method = decodedTxData.method;
    } else if (!mergedTx.method) {
      // Fallback for backwards compatibility
      mergedTx.method =
        mergedTx.input && mergedTx.input !== '0x'
          ? 'Contract Interaction'
          : 'Send';
    }

    for (const [key, value] of Object.entries(mergedTx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? t('send.yes') : t('send.no');

      // For ERC-20 transfers, replace the "to" field with actual recipient
      let finalValue = value;
      if (
        key === 'to' &&
        transactionDisplayInfo?.isErc20Transfer &&
        transactionDisplayInfo.actualRecipient
      ) {
        finalValue = transactionDisplayInfo.actualRecipient;
      }

      const formattedValue: any = {
        value: typeof finalValue === 'boolean' ? formattedBoolean : finalValue,
        label: formattedKey,
        canCopy: false,
      };

      // Special formatting for certain fields
      if (key === 'gasUsed' || key === 'gasLimit') {
        formattedValue.value = finalValue
          ? parseInt(String(finalValue), 10).toLocaleString()
          : 'N/A';
      } else if (
        key === 'gasPrice' ||
        key === 'maxFeePerGas' ||
        key === 'maxPriorityFeePerGas'
      ) {
        formattedValue.value = finalValue
          ? `${(parseInt(String(finalValue), 10) / 1e9).toFixed(2)} Gwei`
          : 'N/A';
      } else if (key === 'revertReason' && finalValue) {
        formattedValue.value = finalValue;
        formattedValue.className = 'text-brand-redDark';
      } else if (key === 'success') {
        formattedValue.value = finalValue ? 'Success' : 'Failed';
        formattedValue.className = finalValue
          ? 'text-brand-green'
          : 'text-brand-redDark';
      } else if (key === 'timestamp') {
        formattedValue.value = finalValue
          ? new Date(Number(finalValue) * 1000).toLocaleString()
          : 'N/A';
      } else if (key === 'method' && finalValue) {
        // Apply translation for method names
        formattedValue.value = formatMethodName(
          String(finalValue),
          currency.toUpperCase(),
          t
        );
      }

      if (String(finalValue).length >= 20 && key !== 'image') {
        formattedValue.canCopy = true;
      }

      const isValid =
        typeof finalValue !== 'object' &&
        finalValue !== undefined &&
        finalValue !== null;

      if (isValid) formattedTransaction.push(formattedValue);
    }
  });

  // Always use enhanced labels since provider data is now normalized to same structure as API
  const labelsToUse = EnhancedEvmTxDetailsLabelsToKeep;

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => labelsToUse.includes(label))
    .sort(
      (a, b) => labelsToUse.indexOf(a.label) - labelsToUse.indexOf(b.label)
    );

  // Handle copy actions with appropriate messages
  const handleCopy = (value: string, label: string) => {
    copy(value ?? '');
    alert.info(getCopyMessage(label));
  };

  return (
    <>
      <TransactionHeader
        txType={getTxType(transactionTx, isTxSent)}
        statusIcon={getTxStatusIcons(getTxType(transactionTx, isTxSent), true)}
        displayInfo={transactionDisplayInfo}
        txStatus={getTxStatus(isTxCanceled, isConfirmed)}
        isLoading={isLoadingDetails}
      />

      <TransactionDetailsList
        details={formattedTransactionDetails}
        onCopy={handleCopy}
      />

      {/* Display decoded transaction parameters */}
      <DecodedTransactionParams decodedData={decodedTxData} />

      {/* Display event logs */}
      <TransactionEventLogs logs={enhancedDetails?.logs} />
    </>
  );
};
