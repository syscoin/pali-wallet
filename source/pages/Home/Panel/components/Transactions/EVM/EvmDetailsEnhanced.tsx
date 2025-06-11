import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  EvmTxDetailsLabelsToKeep,
  EnhancedEvmTxDetailsLabelsToKeep,
} from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import { TransactionsType } from 'state/vault/types';
import {
  camelCaseToText,
  ellipsis,
  removeScientificNotation,
} from 'utils/index';
import { getERC20TransferValue, isERC20Transfer } from 'utils/transactions';

// Transaction details cache with TTL (5 minutes)
const txDetailsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const EvmTransactionDetailsEnhanced = ({ hash }: { hash: string }) => {
  const {
    accounts,
    activeAccount,
    activeNetwork: { chainId, currency, apiUrl },
    coinsList,
  } = useSelector((state: RootState) => state.vault);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];
  const { transactions } = accounts[activeAccount.type][activeAccount.id];
  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const { getTxStatusIcons, getTxStatus, getTxType, getTokenSymbol } =
    useTransactionsListConfig();

  const [copied, copy] = useCopyClipboard();
  const [enhancedDetails, setEnhancedDetails] = useState<any>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: number;
  let txSymbol: string;

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.info(t('home.hashCopied'));
  }, [copied, alert, t]);

  // Fetch enhanced transaction details from API with caching
  useEffect(() => {
    const fetchEnhancedDetails = async () => {
      if (!apiUrl || !hash) return;

      // Check cache first
      const cached = txDetailsCache.get(hash);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setEnhancedDetails(cached.data);
        return;
      }

      setIsLoadingDetails(true);
      try {
        const url = new URL(apiUrl);
        const apiKey = url.searchParams.get('apikey') || '';
        url.search = '';

        const apiEndpoint = `${url.toString()}?module=transaction&action=gettxinfo&txhash=${hash}${
          apiKey ? `&apikey=${apiKey}` : ''
        }`;

        const response = await fetch(apiEndpoint);
        const data = await response.json();

        if (data.status === '1' && data.result) {
          // Cache the result
          txDetailsCache.set(hash, {
            data: data.result,
            timestamp: Date.now(),
          });
          setEnhancedDetails(data.result);
        }
      } catch (error) {
        console.error('Failed to fetch enhanced transaction details:', error);
      } finally {
        setIsLoadingDetails(false);
      }
    };

    fetchEnhancedDetails();
  }, [hash, apiUrl]);

  const formattedTransaction = [];

  const ethereumTransactions = transactions[TransactionsType.Ethereum][
    chainId
  ] as IEvmTransaction[];

  ethereumTransactions?.forEach((transaction: any) => {
    const tx = { ...transaction };

    tx.value = !!tx.value?.hex ? tx.value?.hex : tx.value;

    if (tx?.hash !== hash) return null;
    const isErc20Tx = isERC20Transfer(tx as any);
    transactionTx = tx;

    // Handle value parsing - API returns decimal string, local data might be hex
    let rawValue = tx.value;
    if (enhancedDetails && enhancedDetails.value) {
      rawValue = enhancedDetails.value;
    }

    // Check if value is hex (starts with 0x or has hex property)
    const isHexValue =
      (typeof rawValue === 'string' && rawValue.startsWith('0x')) ||
      (rawValue && typeof rawValue === 'object' && rawValue.hex);

    if (isErc20Tx) {
      txValue = Number(getERC20TransferValue(tx as any)) / 1e18;
    } else if (isHexValue) {
      const hexString = typeof rawValue === 'object' ? rawValue.hex : rawValue;
      txValue = parseInt(hexString, 16) / 1e18;
    } else {
      // Decimal string from API
      txValue = Number(rawValue) / 1e18;
    }

    txSymbol = getTokenSymbol(isErc20Tx, coinsList, tx, currency);
    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = tx.confirmations > 0;
    isTxSent = tx.from.toLowerCase() === currentAccount.address.toLowerCase();

    // Merge with enhanced details if available
    const mergedTx = enhancedDetails ? { ...tx, ...enhancedDetails } : tx;

    // Add method information from decoding if available
    if (mergedTx.input && !mergedTx.method) {
      mergedTx.method = 'Contract Interaction';
    }

    for (const [key, value] of Object.entries(mergedTx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';

      const formattedValue: any = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
      };

      // Special formatting for certain fields
      if (key === 'gasUsed' || key === 'gasLimit') {
        formattedValue.value = value
          ? parseInt(String(value), 10).toLocaleString()
          : 'N/A';
      } else if (
        key === 'gasPrice' ||
        key === 'maxFeePerGas' ||
        key === 'maxPriorityFeePerGas'
      ) {
        formattedValue.value = value
          ? `${(parseInt(String(value), 10) / 1e9).toFixed(2)} Gwei`
          : 'N/A';
      } else if (key === 'revertReason' && value) {
        formattedValue.value = value;
        formattedValue.className = 'text-brand-redDark';
      } else if (key === 'success') {
        formattedValue.value = value ? 'Success' : 'Failed';
        formattedValue.className = value
          ? 'text-brand-green'
          : 'text-brand-redDark';
      } else if (key === 'timestamp') {
        formattedValue.value = value
          ? new Date(Number(value) * 1000).toLocaleString()
          : 'N/A';
      }

      if (String(value).length >= 20 && key !== 'image') {
        formattedValue.canCopy = true;
      }

      const isValid =
        typeof value !== 'object' && value !== undefined && value !== null;

      if (isValid) formattedTransaction.push(formattedValue);
    }
  });

  const labelsToUse = enhancedDetails
    ? EnhancedEvmTxDetailsLabelsToKeep
    : EvmTxDetailsLabelsToKeep;

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => labelsToUse.includes(label))
    .sort(
      (a, b) => labelsToUse.indexOf(a.label) - labelsToUse.indexOf(b.label)
    );

  const RenderTransaction = () => (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        {getTxStatusIcons(getTxType(transactionTx, isTxSent), true)}
        <p className="text-brand-gray200 text-xs font-light">
          {getTxType(transactionTx, isTxSent)}
        </p>
        <p className="text-white text-base">
          {removeScientificNotation(Number(txValue))} {txSymbol}
        </p>
        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
        {isLoadingDetails && (
          <p className="text-xs text-brand-gray200 mt-2">
            Loading enhanced details...
          </p>
        )}
      </div>
      {formattedTransactionDetails.map(
        ({ label, value, canCopy, className }: any) => (
          <Fragment key={uniqueId(hash)}>
            {label.length > 0 && value !== undefined && (
              <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
                <p className="text-xs font-normal text-white">{label}</p>
                <span className={className || ''}>
                  {String(value).length >= 20 ? (
                    <Tooltip content={value} childrenClassName="flex">
                      <p
                        className={`text-xs font-normal ${
                          className || 'text-white'
                        }`}
                      >
                        {ellipsis(String(value), 2, 4)}
                      </p>
                      {canCopy && (
                        <IconButton onClick={() => copy(value ?? '')}>
                          <Icon
                            wrapperClassname="flex items-center justify-center"
                            name="copy"
                            className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                          />
                        </IconButton>
                      )}
                    </Tooltip>
                  ) : (
                    <p
                      className={`text-xs font-normal ${
                        className || 'text-white'
                      }`}
                    >
                      {value}
                    </p>
                  )}
                </span>
              </div>
            )}
          </Fragment>
        )
      )}
      {enhancedDetails?.logs && enhancedDetails.logs.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-white mb-2">
            Event Logs ({enhancedDetails.logs.length})
          </p>
          <div className="max-h-40 overflow-y-auto">
            {enhancedDetails.logs.map((log: any, index: number) => (
              <div key={index} className="mb-2 p-2 bg-bkg-2 rounded text-xs">
                <p className="text-brand-gray200">Log #{index + 1}</p>
                <p className="text-white break-all">
                  Address: {ellipsis(log.address, 6, 4)}
                </p>
                {log.topics && log.topics.length > 0 && (
                  <p className="text-white break-all mt-1">
                    Topics: {log.topics.length}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

  return <RenderTransaction />;
};
