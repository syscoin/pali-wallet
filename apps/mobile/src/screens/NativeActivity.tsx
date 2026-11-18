import { WalletBackHandler as BackHandler } from '../ui/WalletBackHandler';
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
  AppState,
  FlatList,
  Linking,
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
import { activityRowTimestamp } from '../activity/nativeActivity';
import type {
  ActivityRow,
  NativeActivity,
  NativeActivitySnapshot,
} from '../activity/nativeActivity';
const t = nativeI18n.t.bind(nativeI18n);
const activityErrorKeys: Record<NonNullable<NativeActivitySnapshot['error']>, string> = {
  'load-incomplete': 'mobile.activityViews.nativeActivity.loadIncomplete',
  'feed-unavailable': 'mobile.activityViews.nativeActivity.feedUnavailable',
  'older-unavailable': 'mobile.activityViews.nativeActivity.olderUnavailable',
  'position-not-saved': 'mobile.activityViews.nativeActivity.positionNotSaved',
};
const activityCoverageKeys: Record<NativeActivitySnapshot['coverage'], string> = {
  'network-transfers': 'mobile.activityViews.nativeActivity.networkCoverage',
  'explorer-transfers': 'mobile.activityViews.nativeActivity.explorerCoverage',
  'discovery-unavailable': 'mobile.activityViews.nativeActivity.discoveryUnavailable',
};

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
  if (observation && observation.status !== 'pending')
    return observation.status === 'confirmed'
      ? 'confirmed'
      : 'reverted';
  if (!observation && !row.unavailable && row.retainedObservation?.status === 'mined')
    return row.retainedObservation.outcome === 'confirmed' ? 'confirmed' : 'reverted';
  if (row.replacementStatus === 'replaced') return 'replaced';
  if (observation) return 'pending';
  if (!row.unavailable && row.local && row.retainedObservation?.status === 'missing' &&
      BigInt(row.retainedObservation.latestNonce) > BigInt(row.local.nonce)) return 'nonceConsumed';
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
    : !row.unavailable && !row.indexed && row.retainedObservation?.status === 'missing'
    ? 'unconfirmed'
    : row.local?.phase === 'nonce-consumed'
    ? 'nonceConsumed'
    : row.local?.phase === 'confirmed'
    ? 'previouslyConfirmed'
    : row.local?.phase === 'reverted'
    ? 'previouslyReverted'
    : row.unavailable
    ? 'unavailable'
    : row.local
    ? 'unconfirmed'
    : row.checking
    ? 'checking'
    : 'indexed';
};
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
};
const status = (row: ActivityRow) => statusLabels[statusTag(row)]();
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
function privacyPresentation(row: ActivityRow, hideBalances: boolean) {
  const privacy = row.local?.privacyActivity ??
    (row.observation ? row.observation.privacyActivity : row.indexed?.privacyActivity);
  return privacy ? {
    title: t(`privacy.activity.${privacy.kind}`),
    poolBadge: hideBalances ? undefined : t('privacy.poolAmount', { amount: privacy.amount }),
  } : undefined;
}
const rowDate = (row: ActivityRow) => activityDate(activityRowTimestamp(row) || undefined);
/** Shared list presentation for concrete-network and account-wide Activity. */
export function nativeActivityRowPresentation(row: ActivityRow, context: {
  accountAddress: string; nativeSymbol: string; networkName: string; hideBalances: boolean;
}) {
  const flow = direction(row, context.accountAddress);
  const fullAmount = amount(row, context.nativeSymbol);
  const tag = statusTag(row);
  const numeric = !!rowMonetaryAmount(row), state = statusLabels[tag]();
  const date = rowDate(row);
  const movement = flow === 'sent' ? t('send.sent') : flow === 'received' ? t('send.received') : flow === 'self' ? t('mobile.activityViews.nativeActivity.selfTransfer') : t('buttons.activity');
  const privacy = privacyPresentation(row, context.hideBalances);
  const title = privacy?.title ?? (!numeric ? fullAmount : movement);
  const statusSummary = `${state}${row.unavailable && tag !== 'unavailable' ? ` · ${t('mobile.activityViews.nativeActivity.detailsUnavailable')}` : ''}`;
  return {
    date, direction: flow, status: state, statusSummary, fullAmount, numeric,
    title, poolBadge: privacy?.poolBadge,
    subtitle: `${context.networkName} · ${statusSummary}`,
    amount: numeric && context.hideBalances ? HIDDEN_BALANCE : numeric ? compactActivityAmountLabel(`${/^[+−-]/.test(fullAmount) ? '' : flow === 'received' ? '+' : flow === 'sent' ? '-' : ''}${fullAmount}`.replace(/^−/, '-')) : '',
    label: `${privacy?.title ?? movement}. ${privacy?.poolBadge ? `${privacy.poolBadge}. ` : ''}${t('mobile.activityViews.nativeActivity.transactionLabel', { amount: context.hideBalances && numeric ? t('mobile.activityViews.nativeActivity.amountHidden') : fullAmount, status: state, date: date.label, time: date.time })}`,
  };
}
function fee(row: ActivityRow, symbol: string): string {
  try {
    const units = row.unavailable ? undefined : row.observation
      ? row.observation.block
        ? row.observation.feeUnits : undefined
      : row.retainedObservation?.status === 'mined'
        ? row.retainedObservation.feeUnits : undefined;
    if (units !== null && units !== undefined)
      return `${formatBaseUnits(units, 18)} ${symbol}`;
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

export type NativeActivityReviewAction = 'speed-up' | 'cancel' | 'cancel-saved';

export function NativeActivityScreen({
  controller,
  accountLabel,
  onBack,
  navigation,
  onCancelPending,
  onCancelSaved,
  onSpeedUpPending,
  onNavigateToReview,

  initialHash,
  externallyConnected = false,
  detailOnly = false,
}: {
  controller: NativeActivity;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onCancelPending?(hash: string, operationHash?: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
  /** Navigation to a canonical selected-network review, never direct authorization. */
  onNavigateToReview?(action: NativeActivityReviewAction, hash: string, operationHash?: string): void;

  initialHash?: string;
  externallyConnected?: boolean;
  detailOnly?: boolean;
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
      onCancelPending={onCancelPending}
      onCancelSaved={onCancelSaved}
      onSpeedUpPending={onSpeedUpPending}
      onNavigateToReview={onNavigateToReview}

      initialHash={initialHash}
      detailOnly={detailOnly}
    />
  );
}
function NativeActivityContent({
  controller,
  snapshot,
  accountLabel,
  onBack,
  navigation,
  onCancelPending,
  onCancelSaved,
  onSpeedUpPending,
  onNavigateToReview,

  initialHash,
  detailOnly,
}: {
  controller: NativeActivity;
  snapshot: NativeActivitySnapshot;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onCancelPending?(hash: string, operationHash?: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
  onNavigateToReview?(action: NativeActivityReviewAction, hash: string, operationHash?: string): void;

  initialHash?: string;
  detailOnly?: boolean;
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
  const dialogOpen = optionsOpen || copyAddress !== null;
  const lifetime = useRef({ epoch: 0 });
  useEffect(() => {
    const target = initialHash;
    if (snapshot.status === 'loading') { arrival.current = null; return; }
    if (!target || snapshot.status !== 'ready' || !snapshot.scopeKey || arrival.current === target) return;
    arrival.current = target;
    const epoch = lifetime.current.epoch;
    const selectLoaded = () => {
      if (!initialHash || lifetime.current.epoch !== epoch || arrival.current !== target) return false;
      const current = controller.getSnapshot();
      if (current.status !== 'ready' || current.scopeKey !== snapshot.scopeKey) return false;
      if (current.rows.some(row => row.hash === initialHash || row.smartAuthorizations?.some(value => value.instruction.operationHash === initialHash))) {
        setSelected(initialHash);
        controller.inspect(initialHash);
        return true;
      }
      return false;
    };
    if (selectLoaded()) return;
    void controller.loadTarget(target).then(selectLoaded).catch(() => undefined);
  }, [controller, initialHash, snapshot.scopeKey, snapshot.status]);
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
  // Keep unclassified rows visible in this single-network fallback view.
  const rows = snapshot.rows.filter(row => matchesActivityView(row, owner, snapshot.view, 'include'));
  const findRow = (predicate: (row: ActivityRow) => boolean) => snapshot.rows.find(predicate);
  const chosen = findRow((row) => row.hash === selected ||
    row.smartAuthorizations?.some(value => value.instruction.operationHash === selected) === true);
  const authorizationView = useRef({ hash: chosen?.hash, abort: new AbortController() });
  const operation = chosen?.local?.smartAccount?.operations.length === 1
    ? chosen.local.smartAccount.operations[0] : undefined;
  const smartAuthorization = chosen?.smartAuthorizations?.find(value => value.instruction.operationHash === operation?.operationHash);
  const operationHash = smartAuthorization?.instruction.operationHash;
  const inspectAuthorization = useCallback(() => {
    if (!operationHash || AppState.currentState !== 'active') return;
    authorizationView.current.abort.abort();
    const view = { hash: chosen?.hash, abort: new AbortController() };
    authorizationView.current = view;
    const guard = () => {
      if (authorizationView.current !== view || view.abort.signal.aborted || AppState.currentState !== 'active')
        throw Error('CANCELLED');
    };
    void controller.inspectSmartAuthorization(operationHash, guard, view.abort.signal);
  }, [chosen?.hash, controller, operationHash]);
  useLayoutEffect(() => {
    if (!operationHash) return;
    inspectAuthorization();
    const listener = AppState.addEventListener?.('change', next => {
      authorizationView.current.abort.abort();
      if (next === 'active') inspectAuthorization();
    });
    return () => { authorizationView.current.abort.abort(); listener?.remove(); };
  }, [inspectAuthorization, operationHash]);
  const refreshingDetail = !!selected && snapshot.status === 'loading';
  const collectible = chosen?.local?.collectibleTransfer;
  const indexedCollectible = !collectible && chosen?.display?.isNft ? chosen.display : undefined;
  const chosenObservation = chosen ? currentObservation(chosen) : undefined;
  const replacement = findRow((row) => row.local?.originalHash === chosen?.hash &&
    (row.local?.operation === 'cancel' || row.local?.operation === 'speed-up'));
  const original = chosen?.local?.originalHash && findRow((row) => row.hash === chosen.local!.originalHash);
  // A Smart account can use different outer fee payers. Only their own nonce
  // group conflicts; a cancellation of any speed-up descendant still blocks it.
  const detailPrivacy = chosen ? privacyPresentation(chosen, hideBalances) : undefined;
  const replacementBlocksReview = chosen?.local && !!findRow(({ local }) =>
    local?.chainId === chosen.local!.chainId && local.nonce === chosen.local!.nonce &&
    (local.smartAccount?.payer ?? local.address).toLowerCase() ===
      (chosen.local!.smartAccount?.payer ?? chosen.local!.address).toLowerCase() &&
    (local.operation === 'cancel' || (local.originalHash === chosen.hash &&
      local.operation === 'speed-up' && local.phase !== 'signed' && local.phase !== 'attempted'))
  );
  const knownPending = chosenObservation?.status === 'pending' ? chosenObservation : undefined;
  const canReplace = chosen?.replacementStatus !== 'replaced' && chosen?.local && chosen.local.operation !== 'cancel' && !replacementBlocksReview &&
    (chosen.local.transactionType === 0 || chosen.local.transactionType === 2) &&
    knownPending?.from.toLowerCase() === (chosen.local.smartAccount?.payer ?? owner).toLowerCase() &&
    knownPending.nonce === String(chosen.local.nonce);
  const canCancelSaved = chosen?.replacementStatus !== 'replaced' && chosen?.local && !chosen.checking && !chosenObservation &&
    !chosen.local.cancellationUnavailable &&
    chosen.local.operation !== 'cancel' && !replacementBlocksReview &&
    (chosen.local.transactionType === 0 || chosen.local.transactionType === 2) &&
    ['signed', 'attempted', 'submitted'].includes(chosen.local.phase) &&
    chosen.retainedObservation?.status === 'missing' &&
    chosen.retainedObservation.latestNonce === String(chosen.local.nonce);
  const canSpeedUpUnsigned = chosen?.local?.unsignedSpeedUp && chosen.replacementStatus !== 'replaced' &&
    !chosen.checking && !chosenObservation && !replacementBlocksReview &&
    chosen.retainedObservation?.status === 'missing' &&
    BigInt(chosen.retainedObservation.latestNonce) <= BigInt(chosen.local.nonce);
  const reviewAction = (action: NativeActivityReviewAction, direct: ((hash: string) => void) | undefined) => {
    if (!chosen?.local || (chosen.local.unsignedSpeedUp && action === 'cancel-saved')) return undefined;
    if (chosen.local.smartAccount && ['speed-up', 'cancel', 'cancel-saved'].includes(action))
      return direct ?? (onNavigateToReview ? (hash: string) => onNavigateToReview(action, hash) : undefined);
    if (!chosen.local.inspectionOnly) return direct;
    if (chosen.local.reviewNavigation && onNavigateToReview) return (hash: string) => onNavigateToReview(action, hash);
    return chosen.local.unsignedSpeedUp ? direct : undefined;
  };
  const speedUp = (chosen?.local?.inspectionOnly ? chosen.local.reviewNavigation?.speedUp : chosen?.local?.speedUpEligible)
    ? reviewAction('speed-up', onSpeedUpPending) : undefined;
  const cancelPending = reviewAction('cancel', onCancelPending);
  const cancelSaved = reviewAction('cancel-saved', onCancelSaved);
  // An outer receipt/nonce does not revoke its independently usable inner proof.
  const canCancelSmartInstruction = chosen?.local?.smartAccount && !chosen.checking &&
    !chosen.local.cancellationUnavailable && !chosen.local.smartAccount.cancellation &&
    chosen.local.operation !== 'cancel' && !!operation && !smartAuthorization?.instruction.replacesOperationHash &&
    (!smartAuthorization?.observation || smartAuthorization.observation.kind === 'pending');
  const retained = chosen?.retainedObservation;
  const chosenBlock = chosenObservation
    ? chosenObservation.block?.number
    : retained
    ? retained.status === 'mined' ? retained.block.number : undefined
    : chosen?.indexed?.blockNumber || chosen?.observation?.block?.number;
  const hiddenCount = snapshot.rows.filter((row) => zeroOnly(row)).length;
  const savePosition = async (): Promise<void> => {
    if (detailOnly) return;
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
    if (copyAddress !== null) { if (!copying) setCopyAddress(null); return; }
    setDetailsFor(null);
    authorizationView.current.abort.abort();
    if (detailOnly) { onBack(); return; }
    if (selected) setSelected(null);
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
    navigation?.setImmersive(!!detailOnly || !!selected || dialogOpen);
    return () => navigation?.setImmersive(false);
  }, [navigation, selected, dialogOpen, detailOnly]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  });
  const restorePosition = () => {
    if (!snapshot.view.anchor || !rows.length || restoreAttempts.current >= 3)
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
        navigation && !selected && !dialogOpen ? ['top'] : ['top', 'bottom']
      }
      style={s.root}
    >
      <View style={s.activityContent} testID="activity-underlay" pointerEvents={dialogOpen ? 'none' : 'auto'}
        accessibilityElementsHidden={dialogOpen} aria-hidden={dialogOpen} importantForAccessibility={dialogOpen ? 'no-hide-descendants' : 'auto'}>
      <View style={s.header}>
        <Header
          title={chosen || detailOnly || refreshingDetail ? t('mobile.activityViews.nativeActivity.transactionDetails') : t('buttons.activity')}
          subtitle={`${accountLabel}${
            snapshot.networkName ? ` · ${snapshot.networkName}` : ''
          }`}
          onBack={detailOnly || !navigation || chosen || copyAddress ? close : undefined}
          right={!chosen && !detailOnly ? <View style={s.toolbar}>
            <IconButton label={t('mobile.activityViews.nativeActivity.refreshActivity')} icon="refresh"
              disabled={snapshot.status === 'loading' || snapshot.loadingMore}
              onPress={() => {
                restored.current = false;
                void controller.refresh();
              }} />
            <IconButton label={t('mobile.activityViews.nativeActivity.activityOptions')} icon="settings"
              selected={optionsOpen} onPress={() => setOptionsOpen(true)} />
          </View> : undefined}
        />
      </View>
      <View ref={listBounds} style={[s.list, (chosen || detailOnly || refreshingDetail) && s.hidden]}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(row) => row.hash}
          contentContainerStyle={s.content}
          onViewableItemsChanged={visibleItemsChanged}
          onMomentumScrollEnd={savePosition}
          onContentSizeChange={() => {
            if (!restored.current && rows.length) {
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
            <View style={s.section}>
              <SegmentedControl label={t('mobile.activityViews.nativeActivity.activityFilter')} value={snapshot.view.filter}
                options={[{ value: 'all', label: t('mobile.activityViews.nativeActivity.all') }, { value: 'sent', label: t('send.sent') }, { value: 'received', label: t('send.received') }]}
                onChange={(filter) => {
                  controller.setView({ filter, anchor: null, offset: 0 });
                  list.current?.scrollToOffset({ offset: 0 });
                }} />
              <Text style={s.caption}>{t('mobile.activityViews.nativeActivity.recentActivity')}</Text>
              {!!snapshot.error && <Notice title={t('mobile.activityViews.nativeActivity.someActivityIsUnavailable')} body={t(activityErrorKeys[snapshot.error])} tone="amber" />}
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
              networkName: snapshot.networkName ?? snapshot.nativeSymbol ?? t('transactions.replay.network'), hideBalances });
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
              poolBadge={display.poolBadge}
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
            snapshot.status !== 'loading' && !snapshot.error && !snapshot.loadingMore ? (
              snapshot.status === 'unavailable' ? <Notice
                title={t('mobile.activity.unavailableTitle')}
                body={t('mobile.activityViews.nativeActivity.refreshToTryAgain')}
              /> : <View style={s.empty}><Text style={s.emptyTitle}>{t('mobile.activityViews.nativeActivity.noActivityToShow')}</Text><Text style={s.caption}>{t('mobile.activityViews.nativeActivity.refreshOrChooseAnotherFilter')}</Text></View>
            ) : undefined
          }
          ListFooterComponent={
            <View style={s.section}>
              {snapshot.hasMore && (snapshot.loadingMore ? <View style={s.loadingMore}><ActivityIndicator color={colors.blue} /><Text style={s.caption}>{t(rows.length ? 'mobile.activityViews.nativeActivity.loadingOlderActivity' : 'mobile.activityViews.nativeActivity.loadingActivity')}</Text></View> : (
                <Button
                  title={
                    snapshot.error || snapshot.status === 'unavailable'
                      ? t('mobile.activityViews.allNetworksActivity.retryActivity')
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
      {(detailOnly || refreshingDetail) && !chosen && <View style={[s.section, s.content]}>
        <ActivityIndicator accessibilityLabel={t('mobile.activityViews.nativeActivity.loadingTransactionDetails')} color={colors.pink} />
        <Text style={styles.muted}>{t('mobile.activityViews.nativeActivity.loadingTransactionDetails2')}</Text>
      </View>}
      {chosen && (
        <ScrollView key={chosen.hash} contentContainerStyle={[s.content, s.detailContent]}>
          <TransactionDetailLayout
            asset={activityAssetIcon(chosen, snapshot.chainId, snapshot.registrationHash)} registrationHash={snapshot.registrationHash ?? undefined} assetSymbol={chosen.display?.displaySymbol ?? chosen.local?.token?.symbol}
            amount={`${rowMonetaryAmount(chosen) ? direction(chosen, owner) === 'sent' ? '-' : direction(chosen, owner) === 'received' ? '+' : '' : ''}${amount(chosen, snapshot.nativeSymbol ?? 'ETH')}`}
            poolBadge={detailPrivacy?.poolBadge}
            direction={detailPrivacy?.title ?? (direction(chosen, owner) === 'sent' ? t('send.sent') : direction(chosen, owner) === 'received' ? t('send.received') : direction(chosen, owner) === 'self' ? t('mobile.activityViews.nativeActivity.selfTransfer') : t('buttons.activity'))}
            status={status(chosen)}
            tone={(() => { const tag = statusTag(chosen); return tag === 'confirmed' ? 'confirmed' : tag === 'reverted' ? 'failed' : tag === 'pending' || tag === 'replacementPending' ? 'pending' : 'unknown'; })()}
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
              ...(chosen.display?.nftTransfers?.map(item => ({
                label: `${chosen.display!.displaySymbol} #${item.tokenId}`,
                value: hideBalances ? HIDDEN_BALANCE : item.quantity,
              })) ?? []),
              ...(chosen.local?.smartAccount ? [{ label: t('transactions.feePayer'), value: chosen.local.smartAccount.payer,
                actionLabel: t('transactions.copyAddress'), onPress: () => setCopyAddress(chosen.local!.smartAccount!.payer) }] : []),
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
            onPress={() => { controller.inspect(chosen.hash); inspectAuthorization(); }}
          />
          {original && <Button icon="arrow-left" title={t('mobile.activityViews.nativeActivity.viewOriginalTransaction')} variant="secondary" onPress={() => { setSelected(original.hash); controller.inspect(original.hash); }} />}
          {replacement && <Button title={replacement.local?.operation === 'cancel' ? t('mobile.activityViews.nativeActivity.viewCancellationAttempt') : t('mobile.activityViews.nativeActivity.viewSpeedUpAttempt')} variant="secondary" onPress={() => { setSelected(replacement.hash); controller.inspect(replacement.hash); }} />}
          {(canReplace || canSpeedUpUnsigned) && speedUp && (
            <Button title={t('header.speedUp')} variant="secondary" onPress={() => void afterPositionSaved(() => speedUp(chosen.hash))} />
          )}
          {canCancelSmartInstruction && cancelPending && (
            <Button title={t('transactions.smartAuthorizations.cancelInstruction')} variant="secondary" disabled={smartAuthorization?.checking}
              onPress={() => {
                const view = authorizationView.current;
                void afterPositionSaved(() => {
                  if (operationHash) {
                    if (view.hash !== chosen.hash || authorizationView.current !== view || view.abort.signal.aborted || AppState.currentState !== 'active') return;
                    const live = controller.getSnapshot().rows.find(row => row.hash === chosen.hash)?.smartAuthorizations
                      ?.find(value => value.instruction.operationHash === operationHash);
                    if (!live || live.checking || live.observation && live.observation.kind !== 'pending') return;
                    view.abort.abort();
                  }
                  cancelPending(chosen.hash);
                });
              }} />
          )}
          {canReplace && !chosen.local?.smartAccount && (!chosen.local?.cancellationUnavailable || chosen.local.unsignedSpeedUp) && cancelPending && (
            <Button title={t('mobile.activityViews.nativeActivity.cancelPendingTransaction')} variant="secondary" onPress={() => void afterPositionSaved(() => cancelPending(chosen.hash))} />
          )}
          {canCancelSaved && !chosen.local?.smartAccount && cancelSaved && (
            <Button title={t('mobile.activityViews.nativeActivity.cancelSavedTransaction')} variant="secondary" onPress={() => void afterPositionSaved(() => cancelSaved(chosen.hash))} />
          )}
          {!!feedback && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {feedback}
            </Text>
          )}
        </ScrollView>
      )}
      </View>
      {optionsOpen && <SafeAreaView style={s.modal} role="dialog" accessibilityLabel={t('mobile.activityViews.nativeActivity.activityOptions')} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={s.modalContent}>
            <Card style={s.confirm}>
              <Header title={t('mobile.activityViews.nativeActivity.activityOptions')} right={<IconButton label={t('mobile.activityViews.nativeActivity.closeActivityOptions')} icon="close" onPress={() => setOptionsOpen(false)} />} />
              <Text style={styles.muted}>{t(activityCoverageKeys[snapshot.coverage])}</Text>
              {snapshot.truncated && <Notice title={t('mobile.activityViews.nativeActivity.activityHistoryIsLimited')} body={t('mobile.activityViews.nativeActivity.olderRecordsMayBeOmittedTheExplorerMayHave')} />}
              {hiddenCount > 0 && <Text style={styles.muted}>{t('mobile.activityViews.nativeActivity.hiddenZeroTransactions', { count: hiddenCount })}</Text>}
              <Button title={snapshot.view.showZero ? t('mobile.activityViews.nativeActivity.hideZerovalueTokenActivity') : t('mobile.activityViews.nativeActivity.showZerovalueTokenActivity')} variant="secondary"
                onPress={() => { controller.setView({ showZero: !snapshot.view.showZero }); setOptionsOpen(false); }} />
              <Button title={t('privacy.deposit.done')} variant="secondary" onPress={() => setOptionsOpen(false)} />
            </Card>
          </ScrollView>
      </SafeAreaView>}
      {copyAddress !== null && <SafeAreaView style={s.modal} role="dialog" accessibilityLabel={t('mobile.activityViews.nativeActivity.copyThisAddress')} accessibilityViewIsModal>
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
      </SafeAreaView>}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16 },
  toolbar: { flexDirection: 'row' },
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
  activityContent: { flex: 1 },
  modal: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  modalContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  confirm: { padding: 24, gap: 20 },
});
