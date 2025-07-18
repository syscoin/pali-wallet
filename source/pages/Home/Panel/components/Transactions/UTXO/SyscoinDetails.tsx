import { uniqueId } from 'lodash';
import React, { Fragment, useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { UtxoTxDetailsLabelsToKeep } from '../utils/txLabelsDetail';
import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useTransactionsListConfig, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import { TransactionsType } from 'state/vault/types';
import { camelCaseToText, ellipsis } from 'utils/index';
import { isTransactionInBlock } from 'utils/transactionUtils';

// UTXO transaction details cache with TTL (5 minutes - consistent with EVM)
const utxoTxDetailsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

interface ISyscoinTransactionDetailsProps {
  hash: string;
}

// Helper function to format token type to human-readable text
const formatTokenType = (tokenType: string): string => {
  const typeMap: { [key: string]: string } = {
    SPTAssetAllocationBurnToNEVM: 'SPT Bridge to NEVM',
    SPTSyscoinBurnToAssetAllocation: 'SYS → SYSX',
    SPTAssetAllocationBurnToSyscoin: 'SYSX → SYS',
    SPTAssetAllocationSend: 'SPT Transfer',
    SPTAssetAllocationMint: 'SPT Mint from NEVM',
  };

  return typeMap[tokenType] || tokenType.replace(/^SPT/, 'SPT ');
};

export const SyscoinTransactionDetails = ({
  hash,
}: ISyscoinTransactionDetailsProps) => {
  const { controllerEmitter } = useController();
  const {
    activeNetwork: { chainId, url: activeNetworkUrl, currency },
    isBitcoinBased,
  } = useSelector((state: RootState) => state.vault);
  const { getTxType, getTxStatus } = useTransactionsListConfig();
  // Use proper selector
  const accountTransactions = useSelector(selectActiveAccountTransactions);
  const activeAccount = useSelector(selectActiveAccount);

  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();

  const [rawTransaction, setRawTransaction] = useState<any>({});
  const [, copy] = useCopyClipboard();

  // Helper function to get appropriate copy message based on field label
  const getCopyMessage = (label: string) => {
    switch (label.toLowerCase()) {
      case 'from':
      case 'to':
        return t('home.addressCopied');
      case 'txid':
      case 'hash':
      case 'transaction id':
      case 'block hash':
        return t('home.hashCopied');
      case 'input': // Hex data
        return t('send.hexDataCopied');
      case 'method':
      case 'function':
      case 'action':
      case 'confirmations':
      case 'block time':
      case 'fees':
      case 'value':
      case 'success':
        return t('settings.successfullyCopied');
      default:
        return t('settings.successfullyCopied');
    }
  };

  const handleCopyWithMessage = (value: string, label: string) => {
    copy(value);

    alert.info(getCopyMessage(label));
  };

  const recipients: any = {};
  const senders: any = {};
  let isTxCanceled: boolean;
  let isConfirmed: boolean;
  let isTxSent: boolean;
  let transactionTx: any;
  let txValue: number;

  const setTx = async () => {
    // Check cache first (consistent with EVM implementation)
    const cached = utxoTxDetailsCache.get(hash);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setRawTransaction(cached.data);
      return;
    }

    try {
      const rawTxData = await controllerEmitter(
        ['wallet', 'getRawTransaction'],
        [activeNetworkUrl, hash]
      );

      // Cache the result
      utxoTxDetailsCache.set(hash, {
        data: rawTxData,
        timestamp: Date.now(),
      });

      setRawTransaction(rawTxData);
    } catch (error) {
      console.error('Failed to fetch UTXO transaction details:', error);
    }
  };

  useEffect(() => {
    setTx();
  }, [hash]);

  useEffect(() => {
    if (rawTransaction) {
      const { vin, vout } = rawTransaction;

      // Process vins and vouts
      if (vout) {
        for (const voutItem of vout) {
          if (!voutItem.addresses) continue;
          for (const address of voutItem.addresses) {
            if (!recipients[address]) {
              recipients[address] = 0;
            }
            recipients[address] += voutItem.value;
          }
        }
      }

      if (vin) {
        for (const vinItem of vin) {
          if (!vinItem.addresses) continue;
          for (const address of vinItem.addresses) {
            if (!senders[address]) {
              senders[address] = 0;
            }
            senders[address] += vinItem.value;
          }
        }
      }
    }
  }, [rawTransaction]);

  // Get transaction from state
  const syscoinTransactions =
    accountTransactions[TransactionsType.Syscoin]?.[chainId] || [];

  const formattedTransaction: {
    canCopy: boolean;
    label: string;
    value: string;
  }[] = [];

  // Extract SPT information from raw transaction
  const tokenTransfers = rawTransaction?.tokenTransfers || [];
  const tokenType = rawTransaction?.tokenType;

  // Extract asset info from vins and vouts
  const vinAssetInfo = rawTransaction?.vin?.find(
    (v: any) => v.assetInfo
  )?.assetInfo;
  const voutAssetInfo = rawTransaction?.vout?.find(
    (v: any) => v.assetInfo
  )?.assetInfo;
  const assetInfo = vinAssetInfo || voutAssetInfo;

  const hasTokenInfo = tokenTransfers.length > 0 || tokenType || assetInfo;

  syscoinTransactions?.find((tx: any) => {
    if (tx.txid !== hash) return null;
    transactionTx = tx;
    txValue = tx?.vout?.[0]?.value || 0;
    isTxCanceled = tx?.isCanceled === true;
    isConfirmed = isTransactionInBlock(tx);
    isTxSent = isBitcoinBased
      ? false
      : tx.from.toLowerCase() === activeAccount.address.toLowerCase();

    const vinAddresses = tx.vin?.[0]?.addresses || [];
    const vinFormattedValue = {
      value: vinAddresses.join(', '),
      label: 'From',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(vinFormattedValue);

    const voutAddress = tx?.vout?.[0]?.addresses || [];
    const voutFormattedValue = {
      value: voutAddress.join(', '),
      label: 'To',
      canCopy: vinAddresses.length > 0,
    };
    formattedTransaction.push(voutFormattedValue);

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? t('send.yes') : t('send.no');

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : String(value),
        label: formattedKey,
        canCopy: false,
      };

      if (String(value).length >= 20) {
        formattedValue.value = String(value);
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedTransaction.push(formattedValue);
    }

    return formattedTransaction;
  });

  const formattedTransactionDetails = formattedTransaction
    .filter(({ label }) => UtxoTxDetailsLabelsToKeep.includes(label))
    .sort(
      (a, b) =>
        UtxoTxDetailsLabelsToKeep.indexOf(a.label) -
        UtxoTxDetailsLabelsToKeep.indexOf(b.label)
    );

  const RenderTransaction = () => (
    <>
      <div className="flex flex-col justify-center items-center w-full mb-2">
        <p className="text-brand-gray200 text-xs font-light">
          {hasTokenInfo && tokenType
            ? formatTokenType(tokenType)
            : getTxType(transactionTx, isTxSent)}
        </p>

        {/* Display token transfers if available */}
        {tokenTransfers.length > 0 ? (
          <div className="text-center">
            {tokenTransfers.map((transfer: any, index: number) => (
              <div key={index} className="mb-1">
                <p className="text-white text-base">
                  {transfer.valueOut
                    ? `${(
                        Number(transfer.valueOut) /
                        Math.pow(10, transfer.decimals || 8)
                      ).toFixed(4)} ${transfer.symbol || 'Unknown'}`
                    : '0'}
                </p>
                {transfer.name && (
                  <p className="text-brand-gray200 text-xs">{transfer.name}</p>
                )}
              </div>
            ))}
          </div>
        ) : assetInfo ? (
          // Display asset info from vins/vouts if available
          <div className="text-center">
            <p className="text-white text-base">
              {assetInfo.valueStr ||
                `${(Number(assetInfo.value) / Math.pow(10, 8)).toFixed(
                  4
                )} Asset`}
            </p>
            <p className="text-brand-gray200 text-xs">
              Asset GUID: {assetInfo.assetGuid}
            </p>
          </div>
        ) : (
          <p className="text-white text-base">
            {Number(txValue) / 10 ** 8} {currency?.toUpperCase() || 'SYS'}
          </p>
        )}

        <div>{getTxStatus(isTxCanceled, isConfirmed)}</div>
      </div>

      {/* Add token type as a detail if present */}
      {tokenType && (
        <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
          <p className="text-xs font-normal text-white">Transaction Type</p>
          <p className="text-xs font-normal text-white">
            {formatTokenType(tokenType)}
          </p>
        </div>
      )}

      {/* Add token info as details if present */}
      {tokenTransfers.length > 0 &&
        tokenTransfers.map((transfer: any, index: number) => (
          <Fragment key={`token-${index}`}>
            {transfer.token && (
              <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
                <p className="text-xs font-normal text-white">Asset GUID</p>
                <span className="flex items-center">
                  <Tooltip content={transfer.token} childrenClassName="flex">
                    <p className="text-xs font-normal text-white">
                      {transfer.token.length > 12
                        ? ellipsis(transfer.token, 6, 6)
                        : transfer.token}
                    </p>
                    <IconButton
                      onClick={() =>
                        handleCopyWithMessage(transfer.token, 'Asset GUID')
                      }
                    >
                      <CopyIcon />
                    </IconButton>
                  </Tooltip>
                </span>
              </div>
            )}
          </Fragment>
        ))}

      {/* Add asset info from vins/vouts if present and not already shown */}
      {assetInfo && tokenTransfers.length === 0 && assetInfo.assetGuid && (
        <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
          <p className="text-xs font-normal text-white">Asset GUID</p>
          <span className="flex items-center">
            <Tooltip content={assetInfo.assetGuid} childrenClassName="flex">
              <p className="text-xs font-normal text-white">
                {assetInfo.assetGuid.length > 12
                  ? ellipsis(assetInfo.assetGuid, 6, 6)
                  : assetInfo.assetGuid}
              </p>
              <IconButton
                onClick={() =>
                  handleCopyWithMessage(assetInfo.assetGuid, 'Asset GUID')
                }
              >
                <CopyIcon />
              </IconButton>
            </Tooltip>
          </span>
        </div>
      )}

      {formattedTransactionDetails.map(({ label, value, canCopy }: any) => (
        <Fragment key={uniqueId(hash)}>
          {label.length > 0 && value !== undefined && (
            <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
              <p className="text-xs font-normal text-white">{label}</p>
              <span>
                {value.length >= 20 ? (
                  <Tooltip content={value} childrenClassName="flex">
                    <p className="text-xs font-normal text-white">
                      {ellipsis(value, 2, 4)}
                    </p>
                    {canCopy && (
                      <IconButton
                        onClick={() => handleCopyWithMessage(value, label)}
                      >
                        <CopyIcon />
                      </IconButton>
                    )}
                  </Tooltip>
                ) : (
                  <p className="text-xs font-normal text-white">{value}</p>
                )}
              </span>
            </div>
          )}
        </Fragment>
      ))}
    </>
  );

  return <RenderTransaction />;
};
