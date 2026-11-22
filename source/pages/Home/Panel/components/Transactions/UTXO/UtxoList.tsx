import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { parseSyscoinAssetGuid } from '../../../../../../shared/syscoinAssetIds';
import { isPendingZdagActivity } from '../../../../../../shared/utxoActivityStatus';
import { getHomeBrowsingScope } from '../../../../useHomeBrowsingState';
import { useHistoryBrowsingState } from '../useHistoryBrowsingState';
import { useTransactionConfirmationToast } from '../useTransactionConfirmationToast';
import { useTransactionsListConfig } from '../utils/useTransactionsInfos';
import { Icon } from 'components/Icon';
import { DetailArrowSvg } from 'components/Icon/Icon';
import { IconButton } from 'components/IconButton';
import { TokenIcon } from 'components/TokenIcon';
import { Tooltip } from 'components/Tooltip';
import { useContextualState } from 'hooks/useContextualState';
import { useRequestScope } from 'hooks/useRequestScope';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountRef,
  selectActiveAccountAssets,
  selectActiveAccountTransactions,
} from 'state/vault/selectors';
import { selectIsUtxoActivityReplaced } from 'state/vaultGlobal';
import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';
import {
  formatDisplayValue,
  formatSyscoinValue,
} from 'utils/formatSyscoinValue';
import { getTokenLogo } from 'utils/index';
import { ellipsis } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  getSyscoinActivityAssetLabel,
  getSyscoinTransactionTypeStyle,
  getSyscoinActivityOperationAmount,
  formatSyscoinTokenAmount,
  isSyscoinTokenOperation,
  getSyscoinAccountChange,
  formatSyscoinConfirmationETA,
  normalizeSyscoinTransactionType,
} from 'utils/syscoinTransactionUtils';
import {
  translateConfirmationEta,
  translateTransactionType,
} from 'utils/transactionDisplay';
import { isTransactionInBlock } from 'utils/transactionUtils';

import {
  getCachedUtxoTransactionDetails,
  mergeAccountOwnershipFlags,
  subscribeUtxoTransactionDetails,
} from './utxoTransactionDetails';

const SERVER_PAGE_SIZE = 30;
const RECONCILE_TIMEOUT_MS = 10_000;
const mergeHistoryRows = (...lists: ITransactionInfoUtxo[][]) => {
  const seen = new Set<string>();
  return lists.flat().filter((transaction) => {
    const key = transaction?.txid?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const UtxoTransactionsListComponentBase = ({
  tx,
}: {
  tx: ITransactionInfoUtxo;
}) => {
  const { navigate, useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const { getTxStatus, formatTimeStampUtxo, blocktime } =
    useTransactionsListConfig();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAssets = useSelector(selectActiveAccountAssets);
  const walletScope = useSelector(getWalletNavigationScope);
  const isReplaced = useSelector(
    (state: RootState) =>
      !isTransactionInBlock(tx) &&
      selectIsUtxoActivityReplaced(state, walletScope, tx.txid.toLowerCase())
  );
  const scope = `${walletScope.account}:${
    walletScope.network
  }:${tx.txid.toLowerCase()}`;
  const [isCopied, copy, isCurrentCopy] = useCopyClipboard(1000, scope);
  useEffect(() => {
    if (isCopied) alert.success(t('home.hashCopied'), undefined, isCurrentCopy);
  }, [isCopied, isCurrentCopy, alert, t]);
  const cachedDetails = React.useSyncExternalStore(
    useCallback(
      (onChange) => subscribeUtxoTransactionDetails(scope, onChange),
      [scope]
    ),
    useCallback(() => getCachedUtxoTransactionDetails(scope), [scope])
  );
  const displayTransaction = cachedDetails
    ? {
        ...tx,
        ...cachedDetails,
        tokenType: cachedDetails.tokenType || tx.tokenType,
        tokenTransfers: cachedDetails.tokenTransfers ?? tx.tokenTransfers,
        accountAssetTransfers: tx.accountAssetTransfers,
        vin: mergeAccountOwnershipFlags(tx.vin, cachedDetails.vin),
        vout: mergeAccountOwnershipFlags(tx.vout, cachedDetails.vout),
      }
    : tx;
  const normalizedTokenType = normalizeSyscoinTransactionType(
    displayTransaction.tokenType
  );
  const tokenOperation = isSyscoinTokenOperation(displayTransaction);
  const intent = getSyscoinActivityOperationAmount(tx, displayTransaction);
  // Native Activity is the account's signed movement, including fees. Token
  // operation quantities stay separate from their native funding movement.
  const nativeChange = !tokenOperation ? getSyscoinAccountChange(tx) : null;

  const isConfirmed = isTransactionInBlock(tx);

  const isSptTx = Boolean(displayTransaction.tokenType);
  const isZdagConfirmed = isPendingZdagActivity({
    asset: isSptTx,
    inputs: tx?.vin,
    inBlock: isConfirmed,
  });
  const confirmationETA = !isConfirmed
    ? formatSyscoinConfirmationETA(tx)
    : null;

  // Get SPT transaction styling - always returns a style (has default fallback)
  const sptInfo = getSyscoinTransactionTypeStyle(displayTransaction.tokenType);

  // Resolve the SPT asset guid involved in this tx (tokenTransfers first,
  // then vout/vin assetInfo) so we can show the imported asset's icon
  const hasIntent = intent !== null;
  const intentGuid = parseSyscoinAssetGuid(intent?.assetGuid);
  const txAssetGuid = useMemo(() => {
    if (hasIntent) return intentGuid ?? null;

    const transfers = Array.isArray((tx as any)?.tokenTransfers)
      ? (tx as any).tokenTransfers
      : [];
    const fromTransfer = parseSyscoinAssetGuid(
      transfers[0]?.token || transfers[0]?.assetGuid
    );
    if (fromTransfer) return fromTransfer;
    const accountTransfers = Array.isArray((tx as any)?.accountAssetTransfers)
      ? (tx as any).accountAssetTransfers
      : [];
    const fromAccountTransfer = parseSyscoinAssetGuid(
      accountTransfers[0]?.token || accountTransfers[0]?.assetGuid
    );
    if (fromAccountTransfer) return fromAccountTransfer;
    for (const list of [tx?.vout, tx?.vin]) {
      if (!Array.isArray(list)) continue;
      for (const item of list as any[]) {
        const guid = parseSyscoinAssetGuid(item?.assetInfo?.assetGuid);
        if (guid) return guid;
      }
    }
    return null;
  }, [hasIntent, intentGuid, tx]);

  const sptAssetInfo = useMemo(() => {
    if (!txAssetGuid) return null;
    const list = activeAssets?.syscoin || [];
    return (
      list.find(
        (asset: any) =>
          parseSyscoinAssetGuid(asset?.assetGuid) === txAssetGuid &&
          asset.chainId === activeNetwork.chainId
      ) || null
    );
  }, [txAssetGuid, activeAssets?.syscoin, activeNetwork.chainId]);

  // Native values describe wallet movement; SPT values describe the asset.
  let sptAmountDisplay: string | null = null;
  let sysAmountDisplay: string | null = null;
  const sptDecimals = intent?.decimals ?? (sptAssetInfo as any)?.decimals ?? 8;
  if (intent) {
    const symbol = getSyscoinActivityAssetLabel(
      intentGuid,
      sptAssetInfo?.symbol
    );
    const amountText =
      formatSyscoinTokenAmount(intent.amount, sptDecimals) ??
      t('settings.unavailable');
    sptAmountDisplay = `${amountText} ${symbol}`;
  }
  const isSentByUs = nativeChange?.startsWith('-') === true;
  const nativeDirection =
    nativeChange !== null
      ? nativeChange === '0'
        ? undefined
        : isSentByUs
        ? 'sent'
        : 'received'
      : tx.direction === 'sent' || tx.direction === 'received'
      ? tx.direction
      : undefined;
  const signChar = isSentByUs ? '−' : '+';
  const signClass = isSentByUs ? 'text-warning-error' : 'text-brand-green';
  const isSptSentByUs = intent?.direction === 'sent';
  const sptSignChar = isSptSentByUs ? '−' : '+';
  const sptSignClass = isSptSentByUs
    ? 'text-warning-error'
    : 'text-brand-green';
  if (nativeChange !== null) {
    const baseSymbol = activeNetwork?.currency
      ? String(activeNetwork.currency).toUpperCase()
      : '';
    const decimalValue = parseFloat(
      formatSyscoinValue(nativeChange.replace(/^-/, ''))
    );
    sysAmountDisplay = `${formatDisplayValue(decimalValue, 8)} ${baseSymbol}`;
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
    void copy(tx.txid);
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
              aria-label={`${t('buttons.copy')}: ${t('send.transactionId')} ${
                tx.txid
              }`}
            >
              <Icon
                name="Copy"
                className="w-3 h-3 text-brand-gray400 hover:text-brand-royalblue"
              />
            </IconButton>
          </Tooltip>
        </div>
        <div>
          {isReplaced ? (
            <p className="text-xs font-normal text-brand-gray300">
              {t('transactions.replaced')}
            </p>
          ) : isZdagConfirmed ? (
            <Tooltip
              content={
                confirmationETA
                  ? t('transactions.estimatedBlockConfirmation', {
                      eta: translateConfirmationEta(confirmationETA, t),
                    })
                  : null
              }
            >
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
            </Tooltip>
          ) : isConfirmed ? (
            <p className="text-xs font-normal text-brand-green">
              {tokenOperation
                ? intent?.direction
                  ? t(
                      intent.direction === 'sent'
                        ? 'send.sent'
                        : 'send.received'
                    )
                  : t('send.confirmed')
                : nativeDirection
                ? t(nativeDirection === 'sent' ? 'send.sent' : 'send.received')
                : t('send.confirmed')}
            </p>
          ) : (
            <Tooltip
              content={
                confirmationETA
                  ? t('transactions.estimatedConfirmation', {
                      eta: translateConfirmationEta(confirmationETA, t),
                    })
                  : null
              }
            >
              <div className="flex flex-col items-start">
                {getTxStatus(false, isConfirmed)}
                {confirmationETA && (
                  <p className="text-[10px] font-normal text-brand-gray300">
                    ~ {translateConfirmationEta(confirmationETA, t)}
                  </p>
                )}
              </div>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex flex-[0.8] flex-col gap-1">
        {formatTimeStampUtxo(tx[blocktime] * 1000)}
        {(normalizedTokenType || intent) && (
          <div
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full max-w-fit transition-all duration-200 hover:scale-105 hover:brightness-110 cursor-default"
            style={sptInfo.bgStyle}
          >
            <span className="text-xs">{sptInfo.icon}</span>
            <span className="text-[10px] font-medium text-white">
              {translateTransactionType(sptInfo.label, t)}
            </span>
          </div>
        )}
        {sptAmountDisplay && (
          <div
            className="flex items-center gap-1 text-xs font-medium text-white mt-0.5 truncate max-w-[160px]"
            title={sptAmountDisplay}
          >
            {(sptAssetInfo?.image ||
              (sptAssetInfo?.symbol &&
                getTokenLogo(
                  sptAssetInfo.symbol,
                  true,
                  sptAssetInfo.assetGuid,
                  activeNetwork.chainId,
                  sptDecimals
                ))) && (
              <Tooltip content={sptAssetInfo?.name || sptAssetInfo?.symbol}>
                <span className="inline-flex items-center justify-center">
                  <TokenIcon
                    logo={
                      sptAssetInfo.image ||
                      getTokenLogo(
                        sptAssetInfo.symbol,
                        true,
                        sptAssetInfo.assetGuid,
                        activeNetwork.chainId,
                        sptDecimals
                      )
                    }
                    assetGuid={sptAssetInfo.assetGuid}
                    chainId={activeNetwork.chainId}
                    decimals={sptDecimals}
                    symbol={sptAssetInfo.symbol}
                    size={14}
                    className="shrink-0 hover:scale-110 hover:shadow-md transition-transform duration-200"
                  />
                </span>
              </Tooltip>
            )}
            <span className="truncate">
              {intent?.scope === 'account' && intent.direction && (
                <span className={sptSignClass}>{sptSignChar}</span>
              )}
              {sptAmountDisplay}
            </span>
          </div>
        )}
        {!sptAmountDisplay && sysAmountDisplay && (
          <div
            className="flex items-center gap-1 text-xs font-medium text-white mt-0.5 truncate max-w-[160px]"
            title={sysAmountDisplay}
          >
            <span className="truncate">
              {nativeChange !== '0' && (
                <span className={signClass}>{signChar}</span>
              )}
              {sysAmountDisplay}
            </span>
          </div>
        )}
      </div>

      <div>
        <Tooltip content={t('notifications.clickToView')}>
          <DetailArrowSvg
            ariaLabel={t('notifications.clickToView')}
            className="cursor-pointer transition-all duration-200 hover:scale-110 hover:opacity-80"
            onClick={handleGoTxDetails}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export const UtxoTransactionsListComponent = React.memo(
  UtxoTransactionsListComponentBase
);

export const UtxoTransactionsList = ({
  userTransactions,
  firstPageHasMore,
}: {
  firstPageHasMore?: boolean;
  userTransactions: ITransactionInfoUtxo[];
}) => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const currentAccount = useSelector(selectActiveAccount);
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const currentAccountTransactions = useSelector(
    selectActiveAccountTransactions
  );

  const { chainId, url: networkUrl } = activeNetwork as any;
  const confirmationContext = getHomeBrowsingScope(
    { ...currentAccount, ...activeAccountRef },
    activeNetwork,
    true
  );
  const reset = currentAccountTransactions?.utxoActivityReset?.[chainId];
  const paginationContext = reset
    ? `${confirmationContext}:${reset.revision}`
    : confirmationContext;
  const headKey = JSON.stringify(
    userTransactions.map((transaction) => transaction.txid)
  );
  const headHasMore =
    firstPageHasMore ?? userTransactions.length >= SERVER_PAGE_SIZE;
  const beginPageRequest = useRequestScope(paginationContext);

  const fetchHistoryPage = useCallback(
    async (page: number) => {
      const accountKey = currentAccount?.xpub || currentAccount?.address;
      if (!accountKey) throw new Error('Missing account identifier');
      const response = (await controllerEmitter(
        ['wallet', 'getSysTransactionsPage'],
        [accountKey, networkUrl, page, SERVER_PAGE_SIZE, true]
      )) as
        | ITransactionInfoUtxo[]
        | { hasMore: boolean; rows: ITransactionInfoUtxo[] };
      if (Array.isArray(response))
        return { rows: response, hasMore: response.length >= SERVER_PAGE_SIZE };
      if (
        !Array.isArray(response?.rows) ||
        typeof response.hasMore !== 'boolean'
      )
        throw new Error('Invalid transaction history page');
      return response;
    },
    [paginationContext]
  );

  // Merge base transactions with any paged ones we fetch from Blockbook
  const {
    extraTransactions,
    setExtraTransactions,
    visibleCount,
    setVisibleCount,
    nextPage,
    setNextPage,
    hasMoreServer,
    setHasMoreServer,
    isRestoringPages,
  } = useHistoryBrowsingState<ITransactionInfoUtxo>(
    paginationContext,
    undefined,
    networkUrl ? fetchHistoryPage : undefined
  );
  const combined = useMemo(
    () => mergeHistoryRows(userTransactions, extraTransactions),
    [userTransactions, extraTransactions]
  );

  const { filteredTransactions } = useTransactionsListConfig(combined);

  const array = filteredTransactions as ITransactionInfoUtxo[];
  useTransactionConfirmationToast(
    confirmationContext,
    currentAccountTransactions?.syscoin?.[chainId],
    'txid'
  );

  const [isLoadingMore, setIsLoadingMore] = useContextualState<boolean>(
    paginationContext,
    false
  );
  const [reconciliation, setReconciliation] = useContextualState<{
    head: string;
    minimumRows: number;
  } | null>(paginationContext, null);
  const [isReconciling, setIsReconciling] = useContextualState(
    paginationContext,
    false
  );
  const previousHead = useRef({
    context: paginationContext,
    rows: userTransactions,
    key: headKey,
  });
  const latest = useRef({
    context: paginationContext,
    head: headKey,
    headHasMore,
    rows: userTransactions,
    extra: extraTransactions,
  });
  latest.current = {
    context: paginationContext,
    head: headKey,
    headHasMore,
    rows: userTransactions,
    extra: extraTransactions,
  };

  useEffect(() => {
    const previous = previousHead.current;
    previousHead.current = {
      context: paginationContext,
      rows: userTransactions,
      key: headKey,
    };
    if (previous.context !== paginationContext || previous.key === headKey)
      return;
    const oldRows = mergeHistoryRows(previous.rows, extraTransactions);
    const oldIds = new Set(oldRows.map((row) => row.txid));
    const headIds = new Set(userTransactions.map((row) => row.txid));
    // A new live prefix pushes the old page's tail outside the poll's window.
    // Keep that tail until offset pages can be reconciled; removed head rows do
    // not survive merely because they used to belong to page one.
    const lastHeadId = userTransactions[userTransactions.length - 1]?.txid;
    const boundary = previous.rows.findIndex((row) => row.txid === lastHeadId);
    const displaced =
      boundary >= 0
        ? previous.rows.slice(boundary + 1)
        : userTransactions.length
        ? previous.rows
        : [];
    setExtraTransactions((rows) =>
      mergeHistoryRows(displaced, rows).filter((row) => !headIds.has(row.txid))
    );
    const incoming = userTransactions.filter(
      (row) => !oldIds.has(row.txid)
    ).length;
    setVisibleCount((count) => Math.min(count, oldRows.length) + incoming);
    if (headHasMore) setHasMoreServer(true);
    if (
      extraTransactions.length ||
      nextPage > 2 ||
      isLoadingMore ||
      isRestoringPages ||
      (boundary < 0 && displaced.length > 0)
    ) {
      setReconciliation((pending) => ({
        head: headKey,
        minimumRows: Math.max(pending?.minimumRows ?? 0, oldRows.length),
      }));
    }
  }, [paginationContext, headKey]);

  useEffect(() => {
    if (!reconciliation || isLoadingMore || isRestoringPages || !networkUrl)
      return;
    const snapshot = latest.current;
    const isCurrentRequest = beginPageRequest();
    let active = true;
    const current = () =>
      active &&
      isCurrentRequest() &&
      latest.current.context === paginationContext &&
      latest.current.head === reconciliation.head;
    const targetRows = Math.max(
      reconciliation.minimumRows,
      mergeHistoryRows(snapshot.rows, snapshot.extra).length
    );
    // Offset reconciliation is bounded by the depth already retained. If its
    // oldest row vanished in a reorg, use this fresh prefix instead of chasing it.
    const lastPage = Math.max(1, Math.ceil(targetRows / SERVER_PAGE_SIZE));
    setIsReconciling(true);
    const timeout = setTimeout(() => {
      if (!current()) return;
      active = false;
      setIsReconciling(false);
      alert.error(t('settings.apiTimeout'));
    }, RECONCILE_TIMEOUT_MS);
    void (async () => {
      try {
        const rows: ITransactionInfoUtxo[] = [];
        let page = 1;
        let hasMore = snapshot.headHasMore;
        while (
          hasMore &&
          (page < lastPage ||
            (page === lastPage &&
              mergeHistoryRows(snapshot.rows, rows).length < targetRows))
        ) {
          const result = await fetchHistoryPage(page + 1);
          if (!current()) return;
          rows.push(...result.rows);
          page += 1;
          hasMore = result.hasMore;
        }
        if (!current()) return;
        const refreshed = mergeHistoryRows(snapshot.rows, rows);
        // A moving offset may need one overlap page. A full response that still
        // cannot cover the retained depth is not proof those older rows vanished.
        if (hasMore && refreshed.length < targetRows) return;
        const retained = refreshed.slice(0, targetRows);
        const clipped = retained.length < refreshed.length;
        const headIds = new Set(snapshot.rows.map((row) => row.txid));
        setExtraTransactions(retained.filter((row) => !headIds.has(row.txid)));
        // A partially retained final offset page must be reread on Load More.
        // Keeping its whole tail would deepen browsing automatically on every poll.
        setNextPage(clipped ? page : page + 1);
        setHasMoreServer(hasMore || clipped);
        setReconciliation(null);
      } catch (error: any) {
        if (current()) alert.error(String(error?.message || error));
      } finally {
        clearTimeout(timeout);
        if (current()) setIsReconciling(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      setIsReconciling(false);
    };
  }, [paginationContext, reconciliation, isLoadingMore, isRestoringPages]);

  const canLoadPage =
    firstPageHasMore !== false && (hasMoreServer ?? headHasMore);
  return (
    <>
      {array.slice(0, visibleCount).map((tx) => (
        <UtxoTransactionsListComponent key={tx.txid} tx={tx} />
      ))}
      {networkUrl
        ? (reconciliation || canLoadPage || array.length > visibleCount) && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                disabled={isLoadingMore || isRestoringPages || isReconciling}
                onClick={async () => {
                  if (reconciliation) {
                    setReconciliation({ ...reconciliation });
                    return;
                  }
                  if (array.length > visibleCount) {
                    setVisibleCount((count) => count + 50);
                    return;
                  }
                  const isCurrentRequest = beginPageRequest();
                  try {
                    setIsLoadingMore(true);
                    const { rows: newTxs, hasMore } = await fetchHistoryPage(
                      nextPage
                    );
                    if (!isCurrentRequest()) return;
                    const knownTxids = new Set(
                      [...latest.current.rows, ...latest.current.extra]
                        .map((tx) => tx.txid)
                        .filter(Boolean)
                    );
                    const uniqueNewTxs = newTxs.filter(
                      (tx) => tx?.txid && !knownTxids.has(tx.txid)
                    );

                    if (uniqueNewTxs.length > 0) {
                      setExtraTransactions((prev) =>
                        mergeHistoryRows(prev, uniqueNewTxs)
                      );
                      setVisibleCount((count) => count + uniqueNewTxs.length);
                    }
                    setNextPage((p) => p + 1);
                    setHasMoreServer(hasMore);
                  } catch (e: any) {
                    if (isCurrentRequest())
                      alert.error(String(e?.message || e));
                  } finally {
                    if (isCurrentRequest()) setIsLoadingMore(false);
                  }
                }}
                className="px-3 py-1.5 text-xs rounded border border-bkg-white200 text-white hover:bg-alpha-whiteAlpha50 transition-colors disabled:opacity-60"
              >
                {isLoadingMore || isRestoringPages || isReconciling
                  ? t('buttons.loading')
                  : t('buttons.loadMore')}
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
                {t('buttons.loadMore')}
              </button>
            </div>
          )}
    </>
  );
};
