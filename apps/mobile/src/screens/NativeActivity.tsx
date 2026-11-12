import { nativeI18n, useNativeTranslation } from '../platform/localization';
import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, colors, Header, IconButton, Notice, SegmentedControl, styles, Text } from '../ui';
import { formatBaseUnits } from '../core/amounts';
import { formatTokenUnits } from '../../../../source/shared/erc20';
import { activityRowDirection as direction, matchesActivityView, zeroOnlyActivity as zeroOnly } from '../activity/activityFiltering';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { ActivityListRow, activityDate } from './ActivityListRow';
import { activityAssetIcon } from '../activity/assetIcon';
import { TransactionDetailLayout } from './TransactionDetailLayout';
import type { ShellLeafNavigation } from './RealAppShell';
import type {
  ActivityRow,
  NativeActivity,
  NativeActivitySnapshot,
} from '../activity/nativeActivity';
const t = nativeI18n.t.bind(nativeI18n);

// The controller admits observations only for its current account/network generation.
// Unknown or unavailable RPC results leave the existing indexed/local fallback intact.
const currentObservation = (row: ActivityRow) =>
  !row.unavailable &&
  (row.observation?.status === 'confirmed' ||
    row.observation?.status === 'reverted' ||
    row.observation?.status === 'pending')
    ? row.observation
    : undefined;
const statusTag = (row: ActivityRow) => {
  const observation = currentObservation(row);
  if (observation)
    return observation.status === 'confirmed'
      ? 'confirmed'
      : observation.status === 'reverted'
      ? 'reverted'
      : 'pending';
  return row.indexedStatus === 'confirmed'
    ? 'confirmed'
    : row.indexedStatus === 'failed'
    ? 'reverted'
    : row.indexedStatus === 'replaced'
    ? 'replaced'
    : row.indexedStatus === 'replacementPending'
    ? 'replacementPending'
    : row.indexedStatus === 'pending'
    ? 'pending'
    : !row.indexed && row.retainedObservation?.status === 'mined'
    ? row.retainedObservation.outcome === 'confirmed'
      ? 'confirmed'
      : 'reverted'
    : !row.indexed && row.retainedObservation?.status === 'missing'
    ? 'unconfirmed'
    : row.local?.phase === 'nonce-consumed'
    ? 'nonceConsumed'
    : row.local?.phase === 'confirmed'
    ? 'previouslyConfirmed'
    : row.local?.phase === 'reverted'
    ? 'previouslyReverted'
    : row.local
    ? 'unconfirmed'
    : row.checking
    ? 'checking'
    : 'indexed';
};
function savedPendingStatusTag(row: ActivityRow) {
  const retained = row.retainedObservation;
  if (currentObservation(row) || !row.local) return statusTag(row);
  if (retained?.status === 'mined')
    return retained.outcome === 'confirmed' ? 'confirmed' : 'reverted';
  if (retained?.status === 'missing' && BigInt(retained.latestNonce) > BigInt(row.local.nonce))
    return 'nonceConsumed';
  if (row.checking) return 'checking';
  if (row.unavailable) return 'unavailable';
  if (row.local.phase === 'signed') return 'signed';
  if (row.local.phase === 'submitted') return 'submitted';
  return 'unconfirmed';
}
const statusLabels = {
  confirmed: () => t('send.confirmed'),
  reverted: () => t('send.reverted'),
  pending: () => t('send.pending'),
  replaced: () => t('transactions.replaced'),
  replacementPending: () => t('transactions.replacementPending'),
  unconfirmed: () => t('mobile.activityViews.nativeActivity.submissionUnconfirmed'),
  nonceConsumed: () => t('mobile.activityViews.nativeActivity.nonceConsumedOutcomeUnavailable'),
  previouslyConfirmed: () => t('mobile.activityViews.nativeActivity.previouslyConfirmedByPali'),
  previouslyReverted: () => t('mobile.activityViews.nativeActivity.previouslyReverted'),
  checking: () => t('mobile.connections.psbt.checking'),
  indexed: () => t('mobile.activityViews.nativeActivity.indexedNotVerified'),
  unavailable: () => t('mobile.activityViews.nativeActivity.currentStatusUnavailable'),
  signed: () => t('mobile.activityViews.nativeActivity.signedSubmissionNotConfirmed'),
  submitted: () => t('mobile.activityViews.nativeActivity.submittedWaitingForConfirmation'),
};
const status = (row: ActivityRow) => statusLabels[statusTag(row)]();
const savedPendingStatus = (row: ActivityRow) => statusLabels[savedPendingStatusTag(row)]();
function amount(row: ActivityRow, symbol: string): string {
  if (row.local?.collectibleTransfer) return t('mobile.activityViews.nativeActivity.collectibleTransfer');
  if (row.local?.contractInteraction && row.local.amountUnits === '0') return t('transactionDisplay.contractInteraction');
  if (row.display) {
    if (row.display.amountUnavailable) return `? ${row.display.displaySymbol}`;
    if (row.display.hasUnknownDecimals) return t('transactions.symbolTransfer', { symbol: row.display.displaySymbol });
    if (row.display.isNft && row.display.tokenId !== undefined)
      return `${row.display.nftQuantity ?? row.display.formattedValue} ${row.display.displaySymbol} #${row.display.tokenId}`;
    return `${row.display.formattedValue} ${row.display.displaySymbol}`;
  }
  if (row.indexed) return t('mobile.activityViews.nativeActivity.amountUnavailable');
  if (row.local)
    return row.local.token
      ? `${formatTokenUnits(row.local.amountUnits, row.local.token.decimals)} ${
          row.local.token.symbol
        }`
      : `${formatBaseUnits(row.local.amountUnits, 18)} ${symbol}`;
  if (!row.observation)
    return row.candidate?.tokenHint ? t('mobile.activityViews.nativeActivity.erc20Activity') : t('mobile.activityViews.nativeActivity.networkActivity');
  if (row.observation.events.length)
    return t('mobile.activityViews.nativeActivity.tokenTransferEvents', { count: row.observation.events.length });
  return `${formatBaseUnits(row.observation.valueUnits, 18)} ${symbol}`;
}
const rowMonetaryAmount = (row: ActivityRow) => {
  if (row.local?.collectibleTransfer || row.local?.contractInteraction && row.local.amountUnits === '0') return false;
  if (row.display) return !row.display.amountUnavailable && !row.display.hasUnknownDecimals;
  return !row.indexed && (!!row.local || !!row.observation && row.observation.events.length === 0);
};
const rowDate = (row: ActivityRow) => activityDate(row.observation?.timestamp ?? row.candidate?.timestamp ?? row.local?.createdAt);
/** Shared list presentation for concrete-network and account-wide Activity. */
export function nativeActivityRowPresentation(row: ActivityRow, context: {
  accountAddress: string; nativeSymbol: string; networkName: string; hideBalances: boolean; savedPending?: boolean;
}) {
  const flow = direction(row, context.accountAddress), fullAmount = amount(row, context.nativeSymbol);
  const numeric = !!rowMonetaryAmount(row), state = context.savedPending ? savedPendingStatus(row) : status(row);
  const date = rowDate(row);
  return {
    date, direction: flow, status: state, fullAmount, numeric,
    title: !numeric ? fullAmount : flow === 'sent' ? t('send.sent') : flow === 'received' ? t('send.received') : flow === 'self' ? t('mobile.activityViews.nativeActivity.selfTransfer') : t('buttons.activity'),
    subtitle: `${context.networkName} · ${state}${row.unavailable ? ` · ${t('mobile.activityViews.nativeActivity.detailsUnavailable')}` : ''}`,
    amount: numeric && context.hideBalances ? HIDDEN_BALANCE : numeric ? compactActivityAmountLabel(`${/^[+−-]/.test(fullAmount) ? '' : flow === 'received' ? '+' : flow === 'sent' ? '-' : ''}${fullAmount}`.replace(/^−/, '-')) : '',
    label: t('mobile.activityViews.nativeActivity.transactionLabel', { amount: context.hideBalances && numeric ? t('mobile.activityViews.nativeActivity.amountHidden') : fullAmount, status: state, date: date.label, time: date.time }),
  };
}
function fee(row: ActivityRow, symbol: string): string {
  try {
    if (
      row.observation?.feeUnits !== null &&
      row.observation?.feeUnits !== undefined
    )
      return `${formatBaseUnits(row.observation.feeUnits, 18)} ${symbol}`;
  } catch {
    // A malformed observation must not prevent navigation or hide other details.
  }
  return t('mobile.activityViews.nativeActivity.actualFeeNotVerified');
}

function sender(row: ActivityRow, owner: string): string | null {
  return (
    row.local?.collectibleTransfer?.from ?? row.indexed?.from ?? row.observation?.from ?? (row.local ? owner : null)
  );
}
function recipient(row: ActivityRow): string | null {
  if (row.local?.collectibleTransfer) return row.local.collectibleTransfer.recipient;
  if (row.indexed) return row.display?.actualRecipient || null;
  return row.local?.recipient ?? row.observation?.to ?? null;
}

export type NativeActivityReviewAction = 'saved' | 'speed-up' | 'cancel' | 'cancel-saved';

export function NativeActivityScreen({
  controller,
  accountLabel,
  onBack,
  navigation,
  onReplay,
  onCancelPending,
  onCancelSaved,
  onSpeedUpPending,
  onNavigateToReview,
  initialHash,
  externallyConnected = false,
  detailOnly = false,
  savedPendingOnly = false,
}: {
  controller: NativeActivity;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onReplay?(hash: string): void;
  onCancelPending?(hash: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
  /** Navigation to a canonical selected-network review, never direct authorization. */
  onNavigateToReview?(action: NativeActivityReviewAction, hash: string): void;
  initialHash?: string;
  externallyConnected?: boolean;
  detailOnly?: boolean;
  savedPendingOnly?: boolean;
}) {
  useNativeTranslation();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useLayoutEffect(() => externallyConnected ? undefined : controller.connect(), [controller, externallyConnected]);
  return (
    <NativeActivityContent
      key={snapshot.scopeKey ?? 'locked'}
      controller={controller}
      snapshot={snapshot}
      accountLabel={accountLabel}
      onBack={onBack}
      navigation={navigation}
      onReplay={onReplay}
      onCancelPending={onCancelPending}
      onCancelSaved={onCancelSaved}
      onSpeedUpPending={onSpeedUpPending}
      onNavigateToReview={onNavigateToReview}
      initialHash={initialHash}
      detailOnly={detailOnly}
      savedPendingOnly={savedPendingOnly}
    />
  );
}
function NativeActivityContent({
  controller,
  snapshot,
  accountLabel,
  onBack,
  navigation,
  onReplay,
  onCancelPending,
  onCancelSaved,
  onSpeedUpPending,
  onNavigateToReview,
  initialHash,
  detailOnly,
  savedPendingOnly,
}: {
  controller: NativeActivity;
  snapshot: NativeActivitySnapshot;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onReplay?(hash: string): void;
  onCancelPending?(hash: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
  onNavigateToReview?(action: NativeActivityReviewAction, hash: string): void;
  initialHash?: string;
  detailOnly?: boolean;
  savedPendingOnly?: boolean;
}) {
  useNativeTranslation();
  const { hidden: hideBalances } = useBalancePrivacy();
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const arrival = useRef<string | null>(null);
  const [copyAddress, setCopyAddress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const lifetime = useRef({ epoch: 0 });
  useEffect(() => {
    const target = initialHash ?? (savedPendingOnly ? 'saved-pending' : null);
    if (!target || snapshot.status !== 'ready' || !snapshot.scopeKey || arrival.current === target) return;
    arrival.current = target;
    const epoch = lifetime.current.epoch;
    void controller.loadSavedPending().then(() => {
      if (!initialHash || lifetime.current.epoch !== epoch || arrival.current !== target) return;
      const current = controller.getSnapshot();
      if (current.savedPending?.rows.some(row => row.hash === initialHash) || current.rows.some(row => row.hash === initialHash)) {
        setSelected(initialHash);
        controller.inspect(initialHash);
      }
    }).catch(() => undefined);
  }, [controller, initialHash, savedPendingOnly, snapshot.scopeKey, snapshot.status]);
  const list = useRef<FlatList<ActivityRow>>(null);
  const listBounds = useRef<React.ComponentRef<typeof View>>(null);
  const rowViews = useRef(new Map<string, React.ComponentRef<typeof View>>());
  const restored = useRef(false);
  const restoreAttempts = useRef(0);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstVisible = useRef<string | null>(null);
  const navigating = useRef(false);
  const navigateAfterSave = useRef<(() => void) | null>(null);
  const visibleItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: ActivityRow }[] }) => {
      firstVisible.current = viewableItems[0]?.item.hash ?? null;
    },
    []
  );
  useLayoutEffect(() => {
    const local = lifetime.current;
    return () => {
      local.epoch++;
      navigateAfterSave.current = null;
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, []);
  const owner = snapshot.accountAddress ?? '';
  const savedPending = snapshot.savedPending ?? (savedPendingOnly ? { rows: [], status: 'loading' as const, hasMore: false } : undefined);
  // Keep unclassified rows visible in this single-network fallback view.
  const rows = savedPending?.rows ?? snapshot.rows.filter(row => matchesActivityView(row, owner, snapshot.view, 'include'));
  const findRow = (predicate: (row: ActivityRow) => boolean) =>
    savedPending?.rows.find(predicate) ?? snapshot.rows.find(predicate);
  const displayStatus = savedPending ? savedPendingStatus : status;
  const chosen = findRow((row) => row.hash === selected);
  const collectible = chosen?.local?.collectibleTransfer;
  const indexedCollectible = !collectible && chosen?.display?.isNft ? chosen.display : undefined;
  const chosenObservation = chosen ? currentObservation(chosen) : undefined;
  const replacement = findRow((row) => row.local?.originalHash === chosen?.hash &&
    (row.local?.operation === 'cancel' || row.local?.operation === 'speed-up'));
  const original = chosen?.local?.originalHash && findRow((row) => row.hash === chosen.local!.originalHash);
  const replacementBlocksReview = chosen?.local && !!findRow(({ local }) =>
    local?.nonce === chosen.local!.nonce &&
    (local.operation === 'cancel' || (local.originalHash === chosen.hash &&
      local.operation === 'speed-up' && local.phase !== 'signed' && local.phase !== 'attempted'))
  );
  const canReplace = chosen?.local && chosen.local.operation !== 'cancel' && !replacementBlocksReview &&
    (chosen.local.transactionType === 0 || chosen.local.transactionType === 2) &&
    chosenObservation?.status === 'pending' && chosenObservation.from.toLowerCase() === (chosen.local.smartAccount?.payer ?? owner).toLowerCase() &&
    chosenObservation.nonce === String(chosen.local.nonce);
  const canCancelSaved = chosen?.local && !chosen.checking && !chosenObservation &&
    chosen.local.operation !== 'cancel' && !replacementBlocksReview &&
    (chosen.local.transactionType === 0 || chosen.local.transactionType === 2) &&
    ['signed', 'attempted', 'submitted'].includes(chosen.local.phase) &&
    chosen.retainedObservation?.status === 'missing' &&
    chosen.retainedObservation.latestNonce === String(chosen.local.nonce);
  const reviewAction = (action: NativeActivityReviewAction, direct: ((hash: string) => void) | undefined) => {
    if (!chosen?.local) return undefined;
    if (chosen.local.smartAccount && ['speed-up', 'cancel', 'cancel-saved'].includes(action))
      return direct ?? (onNavigateToReview ? (hash: string) => onNavigateToReview(action, hash) : undefined);
    if (!chosen.local.inspectionOnly) return direct;
    if (!chosen.local.reviewNavigation || !onNavigateToReview) return undefined;
    return (hash: string) => onNavigateToReview(action, hash);
  };
  const speedUp = (chosen?.local?.inspectionOnly ? chosen.local.reviewNavigation?.speedUp : chosen?.local?.speedUpEligible)
    ? reviewAction('speed-up', onSpeedUpPending) : undefined;
  const cancelPending = reviewAction('cancel', onCancelPending);
  const cancelSaved = reviewAction('cancel-saved', onCancelSaved);
  const replay = reviewAction('saved', onReplay);
  const retained = chosen?.retainedObservation;
  const chosenBlock = chosenObservation
    ? chosenObservation.block?.number
    : savedPending && retained
    ? retained.status === 'mined' ? retained.block.number : undefined
    : chosen?.indexed?.blockNumber || chosen?.observation?.block?.number;
  const hiddenCount = snapshot.rows.filter((row) => zeroOnly(row)).length;
  const savePosition = async (): Promise<void> => {
    if (savedPending) return;
    const first =
      rows.find((row) => row.hash === firstVisible.current) ?? rows[0];
    if (!first) {
      await controller.setView({ anchor: null, offset: 0 });
      return;
    }
    const captured = lifetime.current.epoch;
    const row = rowViews.current.get(first.hash),
      bounds = listBounds.current;
    if (!row || !bounds) return;
    const position = await new Promise<{
      anchor: string;
      offset: number;
    } | null>((resolve) => {
      // Native layout callbacks are asynchronous. Keep the screen mounted until
      // they finish, but a missing callback must not trap Back navigation.
      const timeout = setTimeout(() => resolve(null), 250);
      bounds.measureInWindow((_x, top) =>
        row.measureInWindow((_rx, y) => {
          clearTimeout(timeout);
          resolve(
            lifetime.current.epoch === captured
              ? {
                  anchor: first.hash,
                  offset: Math.max(0, Math.min(top - y, 10000)),
                }
              : null
          );
        })
      );
    });
    if (position && lifetime.current.epoch === captured)
      await controller.setView(position);
  };
  const afterPositionSaved = async (navigate: () => void): Promise<void> => {
    navigateAfterSave.current = navigate;
    if (navigating.current) return;
    navigating.current = true;
    const captured = lifetime.current.epoch;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // A slow public view-state write must not trap navigation. Its existing
      // context guard still rejects stale completion after this screen leaves.
      await Promise.race([
        savePosition(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 1000);
        }),
      ]);
      const latest = navigateAfterSave.current;
      navigateAfterSave.current = null;
      if (lifetime.current.epoch === captured) latest?.();
    } finally {
      if (timeout) clearTimeout(timeout);
      navigating.current = false;
    }
  };
  const close = () => {
    if (optionsOpen) { setOptionsOpen(false); return; }
    setCopyAddress(null);
    setDetailsFor(null);
    if (detailOnly) { onBack(); return; }
    if (selected) setSelected(null);
    else if (savedPending) {
      restored.current = false;
      restoreAttempts.current = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
      controller.closeSavedPending();
      if (savedPendingOnly) onBack();
    }
    else {
      void afterPositionSaved(onBack);
    }
  };
  useLayoutEffect(() =>
    navigation?.registerBack(() => {
      close();
      return true;
    })
  );
  useLayoutEffect(() =>
    navigation?.registerLeave((navigate) => {
      void afterPositionSaved(navigate);
    })
  );
  useLayoutEffect(() => {
    navigation?.setImmersive(!!detailOnly || !!selected || !!copyAddress);
    return () => navigation?.setImmersive(false);
  }, [navigation, selected, copyAddress, detailOnly]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  });
  const restorePosition = () => {
    if (savedPending || !snapshot.view.anchor || !rows.length || restoreAttempts.current >= 3)
      return;
    const index = rows.findIndex((row) => row.hash === snapshot.view.anchor);
    if (index < 0) {
      restored.current = true;
      setFeedback(
        t('mobile.activityViews.nativeActivity.yourSavedPositionIsOutsideTheCachedHistoryShowing')
      );
      return;
    }
    restoreAttempts.current++;
    list.current?.scrollToIndex({
      index,
      animated: false,
      viewPosition: 0,
      viewOffset: -snapshot.view.offset,
    });
  };
  const copy = async () => {
    const address = copyAddress;
    if (!address || copying) return;
    const captured = lifetime.current.epoch;
    setCopying(true);
    setFeedback('');
    try {
      if ((await Clipboard.setStringAsync(address)) === false)
        throw new Error('COPY_FAILED');
      if (captured === lifetime.current.epoch) {
        setCopyAddress(null);
        setFeedback(t('mobile.activityViews.nativeActivity.addressCopiedVerifyItAgainBeforeSendingFunds'));
      }
    } catch {
      if (captured === lifetime.current.epoch)
        setFeedback(t('mobile.activityViews.nativeActivity.couldNotCopyTheAddressTryAgain'));
    } finally {
      if (captured === lifetime.current.epoch) setCopying(false);
    }
  };
  return (
    <SafeAreaView
      edges={
        navigation && !selected && !copyAddress ? ['top'] : ['top', 'bottom']
      }
      style={s.root}
    >
      <View style={s.header}>
        <Header
          title={chosen || detailOnly ? t('mobile.activityViews.nativeActivity.transactionDetails') : savedPending ? t('mobile.activityViews.nativeActivity.savedPending') : t('buttons.activity')}
          subtitle={`${accountLabel}${
            snapshot.networkName ? ` · ${snapshot.networkName}` : ''
          }`}
          onBack={detailOnly || !navigation || chosen || savedPending || copyAddress ? close : undefined}
          right={!chosen && !detailOnly ? <View style={s.toolbar}>
            <IconButton label={t('mobile.activityViews.nativeActivity.refreshActivity')} icon="refresh"
              disabled={snapshot.status === 'loading' || snapshot.loadingMore || savedPending?.status === 'loading'}
              onPress={() => {
                if (savedPending) void controller.loadSavedPending();
                else { restored.current = false; void controller.refresh(); }
              }} />
            {!savedPending && <IconButton label={t('mobile.activityViews.nativeActivity.activityOptions')} icon="settings"
              selected={optionsOpen} onPress={() => setOptionsOpen(true)} />}
          </View> : undefined}
        />
      </View>
      <View ref={listBounds} style={[s.list, (chosen || detailOnly) && s.hidden]}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(row) => row.hash}
          contentContainerStyle={s.content}
          onViewableItemsChanged={visibleItemsChanged}
          onMomentumScrollEnd={savePosition}
          onContentSizeChange={() => {
            if (!savedPending && !restored.current && rows.length) {
              restored.current = true;
              restorePosition();
            }
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({
              offset: index * averageItemLength,
              animated: false,
            });
            restoreTimer.current = setTimeout(restorePosition, 100);
          }}
          ListHeaderComponent={
            savedPending ? <View style={s.section}>
              <Text style={styles.muted}>{t('mobile.activityViews.nativeActivity.unresolvedTransfersSavedOnThisDevice')}</Text>
              {savedPending.status === 'loading' && <ActivityIndicator accessibilityLabel={t('mobile.activityViews.nativeActivity.loadingSavedTransfers')} color={colors.pink} />}
              {savedPending.status === 'unavailable' && <Notice title={t('mobile.activityViews.nativeActivity.couldNotLoadSavedTransfers')} body={t('mobile.activityViews.nativeActivity.yourSavedTransfersAreUnchangedTryAgain')} tone="amber" />}
            </View> : <View style={s.section}>
              <SegmentedControl label={t('mobile.activityViews.nativeActivity.activityFilter')} value={snapshot.view.filter}
                options={[{ value: 'all', label: t('mobile.activityViews.nativeActivity.all') }, { value: 'sent', label: t('send.sent') }, { value: 'received', label: t('send.received') }]}
                onChange={(filter) => {
                  controller.setView({ filter, anchor: null, offset: 0 });
                  list.current?.scrollToOffset({ offset: 0 });
                }} />
              <View style={s.listHeading}>
                <Text style={s.caption}>{t('mobile.activityViews.nativeActivity.recentActivity')}</Text>
                {snapshot.canViewSavedPending && <Button icon="clock" title={t('mobile.activityViews.nativeActivity.savedPending')} variant="secondary" size="compact"
                  onPress={() => void afterPositionSaved(() => {
                    setFeedback('');
                    list.current?.scrollToOffset({ offset: 0, animated: false });
                    void controller.loadSavedPending();
                  })} />}
              </View>
              {!!snapshot.error && <Notice title={t('mobile.activityViews.nativeActivity.someActivityIsUnavailable')} body={snapshot.error} tone="amber" />}
              {snapshot.status === 'loading' && (
                <ActivityIndicator
                  accessibilityLabel={t('mobile.activityViews.nativeActivity.loadingActivity')}
                  color={colors.pink}
                />
              )}
            </View>
          }
          renderItem={({ item, index }) => {
            const date = rowDate(item), first = index === 0 || rowDate(rows[index - 1]!).key !== date.key;
            const last = index === rows.length - 1 || rowDate(rows[index + 1]!).key !== date.key;
            const display = nativeActivityRowPresentation(item, { accountAddress: owner, nativeSymbol: snapshot.nativeSymbol ?? 'ETH',
              networkName: snapshot.networkName ?? snapshot.nativeSymbol ?? t('transactions.replay.network'), hideBalances, savedPending: !!savedPending });
            return <ActivityListRow
              rowRef={(node) => {
                if (node) rowViews.current.set(item.hash, node);
                else rowViews.current.delete(item.hash);
              }}
              testID={`activity-row-${item.hash}`} direction={display.direction}
              asset={activityAssetIcon(item, snapshot.chainId, snapshot.registrationHash)} registrationHash={snapshot.registrationHash ?? undefined} assetSymbol={item.display?.displaySymbol ?? item.local?.token?.symbol}
              first={first} last={last} heading={first ? date.label : undefined}
              title={display.title}
              subtitle={display.subtitle}
              amount={display.amount}
              time={date.time}
              label={display.label}
              onPress={() =>
                afterPositionSaved(() => {
                  setFeedback('');
                  setSelected(item.hash);
                  controller.inspect(item.hash);
                })
              }
            />;
          }}
          ListEmptyComponent={
            savedPending ? savedPending.status === 'ready' ? <Notice title={t('mobile.activityViews.nativeActivity.noSavedPendingTransfers')} /> : undefined : snapshot.status !== 'loading' ? (
              snapshot.status === 'unavailable' || snapshot.error ? <Notice
                title={
                  snapshot.status === 'unavailable'
                    ? t('mobile.activity.unavailableTitle')
                    : snapshot.error
                    ? t('mobile.activityViews.nativeActivity.activityCouldNotBeLoaded')
                    : t('mobile.activityViews.nativeActivity.noActivityInTheLoadedHistory')
                }
                body={t('mobile.activityViews.nativeActivity.refreshToTryAgain')}
              /> : <View style={s.empty}><Text style={s.emptyTitle}>{t('mobile.activityViews.nativeActivity.noActivityToShow')}</Text><Text style={s.caption}>{t('mobile.activityViews.nativeActivity.refreshOrChooseAnotherFilter')}</Text></View>
            ) : undefined
          }
          ListFooterComponent={
            <View style={s.section}>
              {savedPending ? savedPending.hasMore && savedPending.status !== 'loading' && (
                <Button title={savedPending.status === 'unavailable' ? t('mobile.connections.tryAgain') : t('mobile.activityViews.nativeActivity.loadMoreSavedTransfers')}
                  variant="secondary" onPress={() => void controller.loadSavedPending()} />
              ) : snapshot.hasMore && (snapshot.loadingMore ? <View style={s.loadingMore}><ActivityIndicator color={colors.blue} /><Text style={s.caption}>{t('mobile.activityViews.nativeActivity.loadingOlderActivity')}</Text></View> : (
                <Button
                  title={
                    snapshot.loadingMore
                      ? t('mobile.activityViews.nativeActivity.loadingOlderActivity')
                      : t('mobile.activityViews.nativeActivity.loadOlderActivity')
                  }
                  variant="secondary"
                  size="compact"
                  disabled={snapshot.loadingMore}
                  onPress={() => controller.loadMore()}
                />
              ))}
              {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.build}>{t('mobile.common.development')}</Text>}
            </View>
          }
        />
      </View>
      {detailOnly && !chosen && <View style={[s.section, s.content]}>
        <ActivityIndicator accessibilityLabel={t('mobile.activityViews.nativeActivity.loadingTransactionDetails')} color={colors.pink} />
        <Text style={styles.muted}>{t('mobile.activityViews.nativeActivity.loadingTransactionDetails2')}</Text>
      </View>}
      {chosen && (
        <ScrollView key={chosen.hash} contentContainerStyle={[s.content, s.detailContent]}>
          <TransactionDetailLayout
            asset={activityAssetIcon(chosen, snapshot.chainId, snapshot.registrationHash)} registrationHash={snapshot.registrationHash ?? undefined} assetSymbol={chosen.display?.displaySymbol ?? chosen.local?.token?.symbol}
            amount={`${rowMonetaryAmount(chosen) ? direction(chosen, owner) === 'sent' ? '-' : direction(chosen, owner) === 'received' ? '+' : '' : ''}${amount(chosen, snapshot.nativeSymbol ?? 'ETH')}`}
            direction={direction(chosen, owner) === 'sent' ? t('send.sent') : direction(chosen, owner) === 'received' ? t('send.received') : direction(chosen, owner) === 'self' ? t('mobile.activityViews.nativeActivity.selfTransfer') : t('buttons.activity')}
            status={displayStatus(chosen)}
            tone={(() => { const tag = (savedPending ? savedPendingStatusTag : statusTag)(chosen); return tag === 'confirmed' ? 'confirmed' : tag === 'reverted' ? 'failed' : tag === 'pending' || tag === 'replacementPending' ? 'pending' : 'unknown'; })()}
            rows={[
              { label: t('transactions.replay.network'), value: snapshot.networkName ?? snapshot.nativeSymbol ?? t('transactions.replay.network') },
              { label: t('mobile.activityViews.nativeActivity.date'), value: `${rowDate(chosen).label}${rowDate(chosen).time ? `, ${rowDate(chosen).time}` : ''}` },
              ...(indexedCollectible ? [
                ...(indexedCollectible.tokenId !== undefined ? [{ label: t('send.tokenId'), value: indexedCollectible.tokenId }] : []),
                { label: t('mobile.activityViews.nativeActivity.quantity'), value: indexedCollectible.nftQuantity ?? indexedCollectible.formattedValue },
              ] : []),
              { label: t('send.from'), value: sender(chosen, owner) ?? t('mobile.activityViews.nativeActivity.notAvailable'), actionLabel: t('mobile.activityViews.nativeActivity.copySenderAddress'),
                ...(sender(chosen, owner) ? { onPress: () => setCopyAddress(sender(chosen, owner)) } : {}) },
              { label: t('send.to'), value: recipient(chosen) ?? (chosen.indexed?.to === null || chosen.indexed?.to === '' || chosen.local?.recipient === null ? t('transactions.replay.creation') : t('mobile.activityViews.nativeActivity.notAvailable')),
                actionLabel: t('mobile.activityViews.nativeActivity.copyRecipientAddress'), ...(recipient(chosen) ? { onPress: () => setCopyAddress(recipient(chosen)) } : {}) },
              { label: t('send.networkFee'), value: fee(chosen, snapshot.nativeSymbol ?? 'ETH') },
              { label: t('send.transactionId'), value: chosen.hash },
            ]}
            {...(snapshot.explorerUrl ? { onExplorer: () => { void Linking.openURL(`${snapshot.explorerUrl!.replace(/\/$/, '')}/tx/${chosen.hash}`).catch(() => setFeedback(t('mobile.activityViews.nativeActivity.couldNotOpenTheExplorer'))); } } : {})}
          />
          <Button title={t('send.details')} icon={detailsFor === chosen.hash ? 'chevron-up' : 'chevron-down'} variant="quiet" size="compact" expanded={detailsFor === chosen.hash}
            onPress={() => setDetailsFor(detailsFor === chosen.hash ? null : chosen.hash)} />
          {detailsFor === chosen.hash && <>
          <Text selectable style={s.full}>{amount(chosen, snapshot.nativeSymbol ?? 'ETH')}</Text>
          {chosen.local?.token && !chosen.indexed && (
            <Notice
              title={t('mobile.activityViews.nativeActivity.amountApprovedInPali')}
              body={t('mobile.activityViews.nativeActivity.thisIsTheSavedTransferIntentTokenFeesAnd')}
            />
          )}
          <Card style={s.detail}>
            <Text style={s.label}>{t('transactions.replay.hash')}</Text>
            <Text selectable style={s.full}>
              {chosen.hash}
            </Text>
            <Text style={s.label}>{t('send.from')}</Text>
            <Text style={s.full}>
              {sender(chosen, owner) ?? t('mobile.activityViews.nativeActivity.notAvailable')}
            </Text>
            <Text style={s.label}>
              {collectible
                ? t('mobile.activityViews.nativeActivity.signedRecipient')
                : chosen.local?.token && !chosen.indexed
                ? t('mobile.activityViews.nativeActivity.approvedTokenRecipient')
                : 'TO'}
            </Text>
            <Text style={s.full}>
              {recipient(chosen) ??
                (chosen.indexed?.to === null ||
                chosen.indexed?.to === '' ||
                chosen.local?.recipient === null
                  ? t('transactions.replay.creation')
                  : t('mobile.activityViews.nativeActivity.notAvailable'))}
            </Text>
            {chosen.local?.token && (
              <>
                <Text style={s.label}>{t('assetTransfer.contract')}</Text>
                <Text style={s.full}>{chosen.local.token.contractAddress}</Text>
              </>
            )}
            <Text style={s.label}>{t('send.networkFee')}</Text>
            <Text>{fee(chosen, snapshot.nativeSymbol ?? 'ETH')}</Text>
            {chosenBlock !== undefined && (
              <>
                <Text style={s.label}>{t('send.block')}</Text>
                <Text>{chosenBlock}</Text>
              </>
            )}
          </Card>
          {collectible && (
            <Card style={s.detail}>
              <Text style={s.label}>{t('mobile.activityViews.nativeActivity.signedCollectibleTransfer')}</Text>
              <Text>{collectible.tokenStandard}</Text>
              <Text style={s.label}>{t('send.tokenId')}</Text>
              <Text selectable style={s.full}>
                {collectible.tokenId}
              </Text>
              <Text style={s.label}>{t('mobile.activityViews.nativeActivity.quantity')}</Text>
              <Text selectable style={s.full}>
                {collectible.amountUnits}
              </Text>
              <Text style={s.label}>{t('assetTransfer.contract')}</Text>
              <Text selectable style={s.full}>
                {collectible.contractAddress}
              </Text>
            </Card>
          )}
          {chosen.indexed?.tokenTransfer && (
            <Card style={s.detail}>
              <Text style={s.label}>{t('mobile.activityViews.nativeActivity.indexedTokenTransfer')}</Text>
              <Text style={s.full}>
                {typeof chosen.indexed.tokenTransfer.contractAddress ===
                'string'
                  ? chosen.indexed.tokenTransfer.contractAddress
                  : t('settings.unavailable')}
              </Text>
              <Text>
                {t('mobile.activityViews.nativeActivity.rawTokenUnits', { amount: chosen.display?.amountUnavailable || !['string', 'number', 'bigint'].includes(typeof chosen.indexed.tokenTransfer.value) ? t('settings.unavailable') : String(chosen.indexed.tokenTransfer.value) })}
              </Text>
            </Card>
          )}
          {(chosen.observation?.events ?? []).map((event) => (
            <Card key={event.id} style={s.detail}>
              <Text style={s.label}>
                {t('mobile.activityViews.nativeActivity.erc20TransferLog', { index: event.logIndex })}
              </Text>
              <Text style={s.full}>{event.contractAddress}</Text>
              <Text>{t('mobile.activityViews.nativeActivity.rawTokenUnits', { amount: event.amountUnits })}</Text>
              <Text style={s.label}>{t('send.from')}</Text>
              <Text style={s.full}>{event.from}</Text>
              <Button icon="copy"
                title={t('mobile.activityViews.nativeActivity.copyEventSender')}
                variant="secondary"
                onPress={() => setCopyAddress(event.from)}
              />
              <Text style={s.label}>{t('send.to')}</Text>
              <Text style={s.full}>{event.to}</Text>
              <Button icon="copy"
                title={t('mobile.activityViews.nativeActivity.copyEventRecipient')}
                variant="secondary"
                onPress={() => setCopyAddress(event.to)}
              />
            </Card>
          ))}
          <Notice
            title={t('mobile.activityViews.nativeActivity.checkAddressesIndependently')}
            body={t('mobile.activityViews.nativeActivity.incomingActivityAndTokenMetadataCanBeCreatedBy')}
            tone="amber"
          />
          </>}
          <Button
            title={t('mobile.activityViews.nativeActivity.checkTransactionAgain')}
            variant="secondary"
            onPress={() => controller.inspect(chosen.hash)}
          />
          {original && <Button icon="arrow-left" title={t('mobile.activityViews.nativeActivity.viewOriginalTransaction')} variant="secondary" onPress={() => { setSelected(original.hash); controller.inspect(original.hash); }} />}
          {replacement && <Button title={replacement.local?.operation === 'cancel' ? t('mobile.activityViews.nativeActivity.viewCancellationAttempt') : t('mobile.activityViews.nativeActivity.viewSpeedUpAttempt')} variant="secondary" onPress={() => { setSelected(replacement.hash); controller.inspect(replacement.hash); }} />}
          {canReplace && speedUp && (
            <Button title={t('header.speedUp')} variant="secondary" onPress={() => void afterPositionSaved(() => speedUp(chosen.hash))} />
          )}
          {canReplace && cancelPending && (
            <Button title={t('mobile.activityViews.nativeActivity.cancelPendingTransaction')} variant="secondary" onPress={() => void afterPositionSaved(() => cancelPending(chosen.hash))} />
          )}
          {canCancelSaved && cancelSaved && (
            <Button title={t('mobile.activityViews.nativeActivity.cancelSavedTransaction')} variant="secondary" onPress={() => void afterPositionSaved(() => cancelSaved(chosen.hash))} />
          )}
          {replay && (
            <Button
              title={t('transactions.replay.review')}
              onPress={() => replay(chosen.hash)}
            />
          )}
          {!!feedback && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {feedback}
            </Text>
          )}
        </ScrollView>
      )}
      <Modal visible={optionsOpen} transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
        <SafeAreaView style={s.modal} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.modalContent}>
            <Card style={s.confirm}>
              <Header title={t('mobile.activityViews.nativeActivity.activityOptions')} right={<IconButton label={t('mobile.activityViews.nativeActivity.closeActivityOptions')} icon="close" onPress={() => setOptionsOpen(false)} />} />
              <Text style={styles.muted}>{snapshot.coverage}</Text>
              {snapshot.truncated && <Notice title={t('mobile.activityViews.nativeActivity.activityHistoryIsLimited')} body={t('mobile.activityViews.nativeActivity.olderRecordsMayBeOmittedTheExplorerMayHave')} />}
              {hiddenCount > 0 && <Text style={styles.muted}>{t('mobile.activityViews.nativeActivity.hiddenZeroTransactions', { count: hiddenCount })}</Text>}
              <Button title={snapshot.view.showZero ? t('mobile.activityViews.nativeActivity.hideZerovalueTokenActivity') : t('mobile.activityViews.nativeActivity.showZerovalueTokenActivity')} variant="secondary"
                onPress={() => { controller.setView({ showZero: !snapshot.view.showZero }); setOptionsOpen(false); }} />
              <Button title={t('privacy.deposit.done')} variant="secondary" onPress={() => setOptionsOpen(false)} />
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={copyAddress !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!copying) setCopyAddress(null);
        }}
      >
        <SafeAreaView style={s.modal}>
          <ScrollView contentContainerStyle={s.modalContent}>
            <Card style={s.confirm}>
              <Text style={s.detailAmount}>{t('mobile.activityViews.nativeActivity.copyThisAddress')}</Text>
              <Text style={styles.muted}>
                {t('mobile.activityViews.nativeActivity.historyCanContainMisleadingOrLookalikeAddressesCompareThe')}</Text>
              <Text style={s.full}>{copyAddress}</Text>
              <Button
                title={copying ? t('mobile.activityViews.nativeActivity.copying') : t('mobile.activityViews.nativeActivity.copyFullAddress')}
                disabled={copying}
                onPress={copy}
              />
              <Button
                title={t('buttons.cancel')}
                variant="secondary"
                disabled={copying}
                onPress={() => setCopyAddress(null)}
              />
              {!!feedback && <Text accessibilityRole="alert">{feedback}</Text>}
            </Card>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16 },
  toolbar: { flexDirection: 'row' },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  list: { flex: 1 },
  hidden: { display: 'none' },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 0 },
  detailContent: { gap: 12 },
  section: { gap: 8, paddingVertical: 8 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  loadingMore: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingVertical: 16 },
  detail: { padding: 16, gap: 10 },
  detailAmount: { fontSize: 24, lineHeight: 32, fontWeight: '600', minWidth: 0, maxWidth: '100%' },
  full: { fontSize: 14, lineHeight: 23, color: colors.text },
  label: { fontSize: 11, color: colors.muted, letterSpacing: 1 },
  build: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  modalContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  confirm: { padding: 24, gap: 20 },
});
