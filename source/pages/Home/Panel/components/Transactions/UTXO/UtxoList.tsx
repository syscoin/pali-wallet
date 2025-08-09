import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { Icon } from 'components/Icon';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { IconButton } from 'components/IconButton';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';
import {
  formatDisplayValue,
  formatSyscoinValue,
} from 'utils/formatSyscoinValue';
import { getTokenLogo } from 'utils/index';
import { ellipsis } from 'utils/index';
import {
  getSyscoinTransactionTypeStyle,
  getSyscoinIntentAmount,
} from 'utils/syscoinTransactionUtils';
import { isTransactionInBlock } from 'utils/transactionUtils';

const UtxoTransactionsListComponentBase = ({
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
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const isConfirmed = isTransactionInBlock(tx);

  // Compute Z-DAG confirmed (SPT + RBF disabled + not canceled + not mined yet)
  const MAX_SEQ_MINUS_ONE = 0xfffffffe;
  const rbfEnabled = Array.isArray(tx?.vin)
    ? tx.vin.some(
        (v: any) =>
          typeof v.sequence === 'number' && v.sequence < MAX_SEQ_MINUS_ONE
      )
    : false;
  const isSptTx = Boolean(tx?.tokenType);
  const isZdagConfirmed = isSptTx && !rbfEnabled && !isConfirmed;

  // Get SPT transaction styling - always returns a style (has default fallback)
  const sptInfo = getSyscoinTransactionTypeStyle(tx.tokenType);

  // Compute compact display for SPT and native SYS amounts (intent-based for SPT; vout[0] for SYS)
  let sptAmountDisplay: string | null = null;
  const sptAssetInfo: any | null = null;
  let sysAmountDisplay: string | null = null;
  const intent = getSyscoinIntentAmount(tx);
  if (intent) {
    const decimals = intent.decimals ?? 8;
    const symbol = intent.symbol ?? 'SYSX';
    const amountText = formatDisplayValue(intent.amount, decimals);
    sptAmountDisplay = `${amountText} ${symbol}`;
  }
  // Determine direction using only vin: if any input is ours, we are sending
  const anyVinOwn = Array.isArray(tx?.vin)
    ? tx.vin.some((v: any) => v?.isOwn === true)
    : false;
  const isSentByUs = anyVinOwn;
  const signChar = isSentByUs ? '-' : '+';
  const signClass = isSentByUs ? 'text-warning-error' : 'text-brand-green';
  // Native SYS amount from first vout
  if (!intent && Array.isArray(tx?.vout) && tx.vout.length > 0) {
    const value = Number(tx.vout[0]?.value || 0); // satoshis
    if (!isNaN(value) && value > 0) {
      const baseSymbol = activeNetwork?.currency
        ? String(activeNetwork.currency).toUpperCase()
        : '';
      const decimalValue = parseFloat(formatSyscoinValue(value));
      sysAmountDisplay = `${formatDisplayValue(decimalValue, 8)} ${baseSymbol}`;
    }
  }

  const handleGoTxDetails = () => {
    navigate('/home/details', {
      state: {
        id: null,
        hash: tx.txid,
        tx, // pass the tx so details can use it without relying on redux
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
        <div>
          {isZdagConfirmed ? (
            <div
              className="group inline-flex items-center gap-1 text-xs font-normal cursor-default"
              title="Z-DAG"
            >
              <Icon
                name="thunderbolt"
                className="text-brand-royalbluemedium transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:rotate-6 group-hover:scale-110"
                size={12}
              />
              <span className="text-brand-green">Z-DAG</span>
              <Icon
                name="check"
                className="text-brand-green transition-transform duration-200 group-hover:translate-y-0.5 group-hover:scale-110"
                size={12}
              />
            </div>
          ) : isConfirmed ? (
            <p className="text-xs font-normal text-brand-green">
              {isSentByUs ? 'Sent' : 'Received'}
            </p>
          ) : (
            getTxStatus(false, isConfirmed)
          )}
        </div>
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
        {sptAmountDisplay && (
          <div
            className="flex items-center gap-1 text-[10px] text-brand-gray300 mt-0.5 truncate max-w-[160px]"
            title={sptAmountDisplay}
          >
            <span className={`${signClass}`}>{signChar}</span>
            {(sptAssetInfo?.image ||
              (sptAssetInfo?.symbol && getTokenLogo(sptAssetInfo.symbol))) && (
              <Tooltip content={sptAssetInfo?.name || sptAssetInfo?.symbol}>
                <span className="inline-flex items-center justify-center">
                  <TokenIcon
                    logo={
                      sptAssetInfo.image || getTokenLogo(sptAssetInfo.symbol)
                    }
                    assetGuid={sptAssetInfo.assetGuid}
                    symbol={sptAssetInfo.symbol}
                    size={14}
                    className="shrink-0 hover:scale-110 hover:shadow-md transition-transform duration-200"
                  />
                </span>
              </Tooltip>
            )}
            <span className="truncate">{sptAmountDisplay}</span>
          </div>
        )}
        {!sptAmountDisplay && sysAmountDisplay && (
          <div
            className="flex items-center gap-1 text-[10px] text-brand-gray300 mt-0.5 truncate max-w-[160px]"
            title={sysAmountDisplay}
          >
            <span className={`${signClass}`}>{signChar}</span>
            <span className="truncate">{sysAmountDisplay}</span>
          </div>
        )}
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

export const UtxoTransactionsListComponent = React.memo(
  UtxoTransactionsListComponentBase,
  (prev, next) =>
    prev.tx.txid === next.tx.txid &&
    prev.tx.confirmations === next.tx.confirmations
);

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
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const accountTransactions = useSelector(
    (state: RootState) => state.vault.accountTransactions
  );

  const { chainId, url: networkUrl } = activeNetwork as any;

  // Merge base transactions with any paged ones we fetch from Blockbook
  const [extraTransactions, setExtraTransactions] = useState<
    ITransactionInfoUtxo[]
  >([]);
  const combined = useMemo(() => {
    if (!extraTransactions.length) return userTransactions;
    const seen = new Set<string>();
    const result: ITransactionInfoUtxo[] = [];
    for (const tx of userTransactions) {
      const key = tx.txid;
      if (key) seen.add(key);
      result.push(tx);
    }
    for (const tx of extraTransactions) {
      const key = tx.txid;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(tx);
    }
    return result;
  }, [userTransactions, extraTransactions]);

  const { filteredTransactions } = useTransactionsListConfig(combined);

  // Track the previous confirmation state locally
  const prevConfirmationState = useRef<{ [txid: string]: number }>({});
  const isFirstRender = useRef(true);
  const lastToastTime = useRef<number>(0);

  const currentAccountTransactions =
    accountTransactions[activeAccount.type]?.[activeAccount.id];
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];

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

  // Server-backed pagination using Blockbook pages (fallback to local slicing if needed)
  const [visibleCount, setVisibleCount] = useState<number>(50);
  const [nextPage, setNextPage] = useState<number>(2);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreServer, setHasMoreServer] = useState<boolean>(true);

  // Reset paging on account/network changes
  useEffect(() => {
    setExtraTransactions([]);
    setNextPage(2);
    setHasMoreServer(true);
    setVisibleCount(50);
  }, [currentAccount?.address, currentAccount?.xpub, chainId, networkUrl]);

  return (
    <>
      {(networkUrl ? array : array.slice(0, visibleCount)).map((tx) => (
        <UtxoTransactionsListComponent
          key={tx.txid}
          tx={tx}
          userTransactions={userTransactions}
        />
      ))}
      {networkUrl
        ? hasMoreServer && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                disabled={isLoadingMore}
                onClick={async () => {
                  try {
                    setIsLoadingMore(true);
                    const accountKey =
                      (currentAccount as any)?.xpub ||
                      (currentAccount as any)?.address;
                    if (!accountKey)
                      throw new Error('Missing account identifier');
                    const res = (await controllerEmitter(
                      ['wallet', 'getSysTransactionsPage'],
                      [accountKey, networkUrl, nextPage, 30]
                    )) as any[];
                    const newTxs = Array.isArray(res) ? res : [];
                    if (newTxs.length > 0) {
                      setExtraTransactions((prev) => [...prev, ...newTxs]);
                      setNextPage((p) => p + 1);
                      if (newTxs.length < 30) setHasMoreServer(false);
                    } else {
                      setHasMoreServer(false);
                    }
                  } catch (e: any) {
                    alert.error(String(e?.message || e));
                  } finally {
                    setIsLoadingMore(false);
                  }
                }}
                className="px-3 py-1.5 text-xs rounded border border-bkg-white200 text-white hover:bg-alpha-whiteAlpha50 transition-colors disabled:opacity-60"
              >
                {isLoadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )
        : array.length > visibleCount && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + 50)}
                className="px-3 py-1.5 text-xs rounded border border-bkg-white200 text-white hover:bg-alpha-whiteAlpha50 transition-colors"
              >
                Load more
              </button>
            </div>
          )}
    </>
  );
};
