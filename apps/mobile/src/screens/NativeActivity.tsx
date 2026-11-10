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
import { getEvmHistoryDirection } from '../../../../source/shared/evmHistory';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { ActivityListRow, activityDate } from './ActivityListRow';
import type { ShellLeafNavigation } from './RealAppShell';
import type {
  ActivityRow,
  NativeActivity,
  NativeActivitySnapshot,
} from '../activity/nativeActivity';

// The controller admits observations only for its current account/network generation.
// Unknown or unavailable RPC results leave the existing indexed/local fallback intact.
const currentObservation = (row: ActivityRow) =>
  !row.unavailable &&
  (row.observation?.status === 'confirmed' ||
    row.observation?.status === 'reverted' ||
    row.observation?.status === 'pending')
    ? row.observation
    : undefined;
const status = (row: ActivityRow) => {
  const observation = currentObservation(row);
  if (observation)
    return observation.status === 'confirmed'
      ? 'Confirmed'
      : observation.status === 'reverted'
      ? 'Reverted'
      : 'Pending';
  return row.indexedStatus === 'confirmed'
    ? 'Confirmed'
    : row.indexedStatus === 'failed'
    ? 'Reverted'
    : row.indexedStatus === 'replaced'
    ? 'Replaced'
    : row.indexedStatus === 'replacementPending'
    ? 'Replacement pending'
    : row.indexedStatus === 'pending'
    ? 'Pending'
    : !row.indexed && row.retainedObservation?.status === 'mined'
    ? row.retainedObservation.outcome === 'confirmed'
      ? 'Confirmed'
      : 'Reverted'
    : !row.indexed && row.retainedObservation?.status === 'missing'
    ? 'Submission unconfirmed'
    : row.local?.phase === 'nonce-consumed'
    ? 'Nonce consumed · outcome unavailable'
    : row.local?.phase === 'confirmed'
    ? 'Previously confirmed by Pali'
    : row.local?.phase === 'reverted'
    ? 'Previously reverted'
    : row.local
    ? 'Submission unconfirmed'
    : row.checking
    ? 'Checking transaction…'
    : 'Indexed · not verified';
};
function savedPendingStatus(row: ActivityRow) {
  const retained = row.retainedObservation;
  if (currentObservation(row) || !row.local) return status(row);
  if (retained?.status === 'mined')
    return retained.outcome === 'confirmed' ? 'Confirmed' : 'Reverted';
  if (retained?.status === 'missing' && BigInt(retained.latestNonce) > BigInt(row.local.nonce))
    return 'Nonce consumed · outcome unavailable';
  if (row.checking) return 'Checking transaction…';
  if (row.unavailable) return 'Current status unavailable';
  if (row.local.phase === 'signed') return 'Signed · submission not confirmed';
  if (row.local.phase === 'submitted') return 'Submitted · waiting for confirmation';
  return 'Submission unconfirmed';
}
function direction(
  row: ActivityRow,
  owner: string
): 'sent' | 'received' | 'self' | 'unknown' {
  const collectible = row.local?.collectibleTransfer;
  if (collectible)
    return getEvmHistoryDirection({ from: collectible.from, to: collectible.recipient }, owner);
  if (row.indexed) return getEvmHistoryDirection(row.indexed, owner);
  if (row.local)
    return getEvmHistoryDirection(
      { from: owner, to: row.local.recipient },
      owner
    );
  const tx = row.observation;
  if (!tx) return 'unknown';
  return getEvmHistoryDirection(tx, owner, tx.events);
}
function zeroOnly(row: ActivityRow) {
  if (row.indexed) return row.zeroValueToken === true;
  return (
    !row.local &&
    row.observation &&
    row.observation.valueUnits === '0' &&
    row.observation.events.length > 0 &&
    row.observation.events.every((event) => event.amountUnits === '0')
  );
}
function amount(row: ActivityRow, symbol: string): string {
  if (row.local?.collectibleTransfer) return 'Collectible transfer';
  if (row.local?.contractInteraction && row.local.amountUnits === '0') return 'Contract interaction';
  if (row.display) {
    if (row.display.amountUnavailable) return `? ${row.display.displaySymbol}`;
    if (row.display.hasUnknownDecimals) return `${row.display.displaySymbol} transfer`;
    return `${row.display.formattedValue} ${row.display.displaySymbol}`;
  }
  if (row.indexed) return 'Amount unavailable';
  if (row.local)
    return row.local.token
      ? `${formatTokenUnits(row.local.amountUnits, row.local.token.decimals)} ${
          row.local.token.symbol
        }`
      : `${formatBaseUnits(row.local.amountUnits, 18)} ${symbol}`;
  if (!row.observation)
    return row.candidate?.tokenHint ? 'ERC20 activity' : 'Network activity';
  if (row.observation.events.length)
    return `${row.observation.events.length} token transfer event${
      row.observation.events.length === 1 ? '' : 's'
    }`;
  return `${formatBaseUnits(row.observation.valueUnits, 18)} ${symbol}`;
}
const rowMonetaryAmount = (row: ActivityRow) => {
  if (row.local?.collectibleTransfer || row.local?.contractInteraction && row.local.amountUnits === '0') return false;
  if (row.display) return !row.display.amountUnavailable && !row.display.hasUnknownDecimals;
  return !row.indexed && (!!row.local || !!row.observation && row.observation.events.length === 0);
};
const rowDate = (row: ActivityRow) => activityDate(row.observation?.timestamp ?? row.candidate?.timestamp ?? row.local?.createdAt);
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
  return 'Actual fee not verified';
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

export function NativeActivityScreen({
  controller,
  accountLabel,
  onBack,
  navigation,
  onReplay,
  onCancelPending,
  onCancelSaved,
  onSpeedUpPending,
  initialHash,
}: {
  controller: NativeActivity;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onReplay?(hash: string): void;
  onCancelPending?(hash: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
  initialHash?: string;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useLayoutEffect(() => controller.connect(), [controller]);
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
      initialHash={initialHash}
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
  initialHash,
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
  initialHash?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const arrival = useRef<string | null>(null);
  const [copyAddress, setCopyAddress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const lifetime = useRef({ epoch: 0 });
  useEffect(() => {
    if (!initialHash || snapshot.status !== 'ready' || !snapshot.scopeKey || arrival.current === initialHash) return;
    arrival.current = initialHash;
    const epoch = lifetime.current.epoch;
    void controller.loadSavedPending().then(() => {
      if (lifetime.current.epoch !== epoch || arrival.current !== initialHash) return;
      const current = controller.getSnapshot();
      if (current.savedPending?.rows.some(row => row.hash === initialHash) || current.rows.some(row => row.hash === initialHash)) {
        setSelected(initialHash);
        controller.inspect(initialHash);
      }
    }).catch(() => undefined);
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
  const savedPending = snapshot.savedPending;
  const rows = savedPending?.rows ?? snapshot.rows.filter(
    (row) =>
      (snapshot.view.showZero || !zeroOnly(row)) &&
      (snapshot.view.filter === 'all' ||
        direction(row, owner) === 'unknown' ||
        direction(row, owner) === snapshot.view.filter)
  );
  const findRow = (predicate: (row: ActivityRow) => boolean) =>
    savedPending?.rows.find(predicate) ?? snapshot.rows.find(predicate);
  const displayStatus = savedPending ? savedPendingStatus : status;
  const chosen = findRow((row) => row.hash === selected);
  const collectible = chosen?.local?.collectibleTransfer;
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
    chosenObservation?.status === 'pending' && chosenObservation.from.toLowerCase() === owner.toLowerCase() &&
    chosenObservation.nonce === String(chosen.local.nonce);
  const canCancelSaved = chosen?.local && !chosen.checking && !chosenObservation &&
    chosen.local.operation !== 'cancel' && !replacementBlocksReview &&
    (chosen.local.transactionType === 0 || chosen.local.transactionType === 2) &&
    ['signed', 'attempted', 'submitted'].includes(chosen.local.phase) &&
    chosen.retainedObservation?.status === 'missing' &&
    chosen.retainedObservation.latestNonce === String(chosen.local.nonce);
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
    if (selected) setSelected(null);
    else if (savedPending) {
      restored.current = false;
      restoreAttempts.current = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
      controller.closeSavedPending();
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
    navigation?.setImmersive(!!selected || !!copyAddress);
    return () => navigation?.setImmersive(false);
  }, [navigation, selected, copyAddress]);
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
        'Your saved position is outside the cached history. Showing recent activity.'
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
        setFeedback('Address copied. Verify it again before sending funds.');
      }
    } catch {
      if (captured === lifetime.current.epoch)
        setFeedback('Could not copy the address. Try again.');
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
          title={chosen ? 'Transaction details' : savedPending ? 'Saved pending' : 'Activity'}
          subtitle={`${accountLabel}${
            snapshot.networkName ? ` · ${snapshot.networkName}` : ''
          }`}
          onBack={close}
          right={!chosen ? <View style={s.toolbar}>
            <IconButton label="Refresh activity" icon="refresh"
              disabled={snapshot.status === 'loading' || snapshot.loadingMore || savedPending?.status === 'loading'}
              onPress={() => {
                if (savedPending) void controller.loadSavedPending();
                else { restored.current = false; void controller.refresh(); }
              }} />
            {!savedPending && <IconButton label="Activity options" icon="settings"
              selected={optionsOpen} onPress={() => setOptionsOpen(true)} />}
          </View> : undefined}
        />
      </View>
      <View ref={listBounds} style={[s.list, chosen && s.hidden]}>
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
              <Text style={styles.muted}>Unresolved transfers saved on this device.</Text>
              {savedPending.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading saved transfers" color={colors.pink} />}
              {savedPending.status === 'unavailable' && <Notice title="Could not load saved transfers" body="Your saved transfers are unchanged. Try again." tone="amber" />}
            </View> : <View style={s.section}>
              <SegmentedControl label="Activity filter" value={snapshot.view.filter}
                options={[{ value: 'all', label: 'All' }, { value: 'sent', label: 'Sent' }, { value: 'received', label: 'Received' }]}
                onChange={(filter) => {
                  controller.setView({ filter, anchor: null, offset: 0 });
                  list.current?.scrollToOffset({ offset: 0 });
                }} />
              <View style={s.listHeading}>
                <Text style={s.caption}>Recent activity</Text>
                {snapshot.canViewSavedPending && <Button title="Saved pending" variant="quiet" size="compact"
                  onPress={() => void afterPositionSaved(() => {
                    setFeedback('');
                    list.current?.scrollToOffset({ offset: 0, animated: false });
                    void controller.loadSavedPending();
                  })} />}
              </View>
              {!!snapshot.error && <Notice title="Some activity is unavailable" body={snapshot.error} tone="amber" />}
              {snapshot.status === 'loading' && (
                <ActivityIndicator
                  accessibilityLabel="Loading activity"
                  color={colors.pink}
                />
              )}
            </View>
          }
          renderItem={({ item, index }) => {
            const date = rowDate(item), first = index === 0 || rowDate(rows[index - 1]!).key !== date.key;
            const last = index === rows.length - 1 || rowDate(rows[index + 1]!).key !== date.key;
            const flow = direction(item, owner), fullAmount = amount(item, snapshot.nativeSymbol ?? 'ETH');
            const isNumeric = !!rowMonetaryAmount(item);
            return <ActivityListRow
              rowRef={(node) => {
                if (node) rowViews.current.set(item.hash, node);
                else rowViews.current.delete(item.hash);
              }}
              testID={`activity-row-${item.hash}`} direction={flow}
              first={first} last={last} heading={first ? date.label : undefined}
              title={!isNumeric ? fullAmount : flow === 'sent' ? 'Sent' : flow === 'received' ? 'Received' : flow === 'self' ? 'Self transfer' : 'Activity'}
              subtitle={`${snapshot.networkName ?? snapshot.nativeSymbol ?? 'Network'} · ${displayStatus(item)}${item.unavailable ? ' · Details unavailable' : ''}`}
              amount={isNumeric ? compactActivityAmountLabel(`${/^[+−-]/.test(fullAmount) ? '' : flow === 'received' ? '+' : flow === 'sent' ? '-' : ''}${fullAmount}`.replace(/^−/, '-')) : ''}
              time={date.time}
              label={`${fullAmount}, ${displayStatus(item)}. ${date.label} ${date.time}. View transaction details`}
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
            savedPending ? savedPending.status === 'ready' ? <Notice title="No saved pending transfers" /> : undefined : snapshot.status !== 'loading' ? (
              snapshot.status === 'unavailable' || snapshot.error ? <Notice
                title={
                  snapshot.status === 'unavailable'
                    ? 'Activity unavailable'
                    : snapshot.error
                    ? 'Activity could not be loaded'
                    : 'No activity in the loaded history'
                }
                body="Refresh to try again."
              /> : <View style={s.empty}><Text style={s.emptyTitle}>No activity to show</Text><Text style={s.caption}>Refresh or choose another filter.</Text></View>
            ) : undefined
          }
          ListFooterComponent={
            <View style={s.section}>
              {savedPending ? savedPending.hasMore && savedPending.status !== 'loading' && (
                <Button title={savedPending.status === 'unavailable' ? 'Try again' : 'Load more saved transfers'}
                  variant="secondary" onPress={() => void controller.loadSavedPending()} />
              ) : snapshot.hasMore && (snapshot.loadingMore ? <View style={s.loadingMore}><ActivityIndicator color={colors.blue} /><Text style={s.caption}>Loading older activity…</Text></View> : (
                <Button
                  title={
                    snapshot.loadingMore
                      ? 'Loading older activity…'
                      : 'Load older activity'
                  }
                  variant="secondary"
                  size="compact"
                  disabled={snapshot.loadingMore}
                  onPress={() => controller.loadMore()}
                />
              ))}
              {typeof __DEV__ !== 'undefined' && __DEV__ && <Text style={s.build}>Development build · Use a test wallet</Text>}
            </View>
          }
        />
      </View>
      {chosen && (
        <ScrollView key={chosen.hash} contentContainerStyle={[s.content, s.detailContent]}>
          <Text style={s.detailAmount}>
            {amount(chosen, snapshot.nativeSymbol ?? 'ETH')}
          </Text>
          <Text style={styles.muted}>{displayStatus(chosen)}</Text>
          {chosen.local?.token && !chosen.indexed && (
            <Notice
              title="Amount approved in Pali"
              body="This is the saved transfer intent. Token fees and other contract behavior can change the amount received. Receipt events are shown separately below."
            />
          )}
          <Card style={s.detail}>
            <Text style={s.label}>TRANSACTION HASH</Text>
            <Text selectable style={s.full}>
              {chosen.hash}
            </Text>
            <Text style={s.label}>FROM</Text>
            <Text style={s.full}>
              {sender(chosen, owner) ?? 'Not available'}
            </Text>
            {!!sender(chosen, owner) && (
              <Button
                title="Copy sender address"
                variant="quiet"
                onPress={() => setCopyAddress(sender(chosen, owner))}
              />
            )}
            <Text style={s.label}>
              {collectible
                ? 'SIGNED RECIPIENT'
                : chosen.local?.token && !chosen.indexed
                ? 'APPROVED TOKEN RECIPIENT'
                : 'TO'}
            </Text>
            <Text style={s.full}>
              {recipient(chosen) ??
                (chosen.indexed?.to === null ||
                chosen.indexed?.to === '' ||
                chosen.local?.recipient === null
                  ? 'Contract creation'
                  : 'Not available')}
            </Text>
            {!!recipient(chosen) && (
              <Button
                title="Copy recipient address"
                variant="quiet"
                onPress={() => setCopyAddress(recipient(chosen))}
              />
            )}
            {chosen.local?.token && (
              <>
                <Text style={s.label}>TOKEN CONTRACT</Text>
                <Text style={s.full}>{chosen.local.token.contractAddress}</Text>
              </>
            )}
            <Text style={s.label}>NETWORK FEE</Text>
            <Text>{fee(chosen, snapshot.nativeSymbol ?? 'ETH')}</Text>
            {chosenBlock !== undefined && (
              <>
                <Text style={s.label}>BLOCK</Text>
                <Text>{chosenBlock}</Text>
              </>
            )}
          </Card>
          {collectible && (
            <Card style={s.detail}>
              <Text style={s.label}>SIGNED COLLECTIBLE TRANSFER</Text>
              <Text>{collectible.tokenStandard}</Text>
              <Text style={s.label}>TOKEN ID</Text>
              <Text selectable style={s.full}>
                {collectible.tokenId}
              </Text>
              <Text style={s.label}>QUANTITY</Text>
              <Text selectable style={s.full}>
                {collectible.amountUnits}
              </Text>
              <Text style={s.label}>TOKEN CONTRACT</Text>
              <Text selectable style={s.full}>
                {collectible.contractAddress}
              </Text>
            </Card>
          )}
          {chosen.indexed?.tokenTransfer && (
            <Card style={s.detail}>
              <Text style={s.label}>INDEXED TOKEN TRANSFER</Text>
              <Text style={s.full}>
                {typeof chosen.indexed.tokenTransfer.contractAddress ===
                'string'
                  ? chosen.indexed.tokenTransfer.contractAddress
                  : 'Unavailable'}
              </Text>
              <Text>
                Raw token units:{' '}
                {chosen.display?.amountUnavailable ||
                !['string', 'number', 'bigint'].includes(
                  typeof chosen.indexed.tokenTransfer.value
                )
                  ? 'Unavailable'
                  : String(chosen.indexed.tokenTransfer.value)}
              </Text>
            </Card>
          )}
          {(chosen.observation?.events ?? []).map((event) => (
            <Card key={event.id} style={s.detail}>
              <Text style={s.label}>
                ERC20 TRANSFER EVENT · LOG {event.logIndex}
              </Text>
              <Text style={s.full}>{event.contractAddress}</Text>
              <Text>Raw token units: {event.amountUnits}</Text>
              <Text style={s.label}>FROM</Text>
              <Text style={s.full}>{event.from}</Text>
              <Button
                title="Copy event sender"
                variant="quiet"
                onPress={() => setCopyAddress(event.from)}
              />
              <Text style={s.label}>TO</Text>
              <Text style={s.full}>{event.to}</Text>
              <Button
                title="Copy event recipient"
                variant="quiet"
                onPress={() => setCopyAddress(event.to)}
              />
            </Card>
          ))}
          <Notice
            title="Check addresses independently"
            body="Incoming activity and token metadata can be created by anyone. A transfer event does not prove a token is trustworthy or that its balance changed by the same amount."
            tone="amber"
          />
          <Button
            title="Check transaction again"
            variant="secondary"
            onPress={() => controller.inspect(chosen.hash)}
          />
          {original && <Button title="View original transaction" variant="quiet" onPress={() => { setSelected(original.hash); controller.inspect(original.hash); }} />}
          {replacement && <Button title={replacement.local?.operation === 'cancel' ? 'View cancellation attempt' : 'View Speed Up attempt'} variant="secondary" onPress={() => { setSelected(replacement.hash); controller.inspect(replacement.hash); }} />}
          {canReplace && chosen.local?.speedUpEligible && onSpeedUpPending && (
            <Button title="Speed Up" variant="secondary" onPress={() => void afterPositionSaved(() => onSpeedUpPending(chosen.hash))} />
          )}
          {canReplace && onCancelPending && (
            <Button title="Cancel pending transaction" variant="secondary" onPress={() => void afterPositionSaved(() => onCancelPending(chosen.hash))} />
          )}
          {canCancelSaved && onCancelSaved && (
            <Button title="Cancel saved transaction" variant="secondary" onPress={() => void afterPositionSaved(() => onCancelSaved(chosen.hash))} />
          )}
          {chosen.local && !chosen.local.inspectionOnly && onReplay && (
            <Button
              title="Review resend"
              onPress={() => onReplay(chosen.hash)}
            />
          )}
          {snapshot.explorerUrl && (
            <Button
              title="View on explorer"
              variant="quiet"
              onPress={() => {
                void Linking.openURL(
                  `${snapshot.explorerUrl!.replace(/\/$/, '')}/tx/${
                    chosen.hash
                  }`
                ).catch(() => setFeedback('Could not open the explorer.'));
              }}
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
              <Header title="Activity options" right={<IconButton label="Close activity options" icon="close" onPress={() => setOptionsOpen(false)} />} />
              <Text style={styles.muted}>{snapshot.coverage}</Text>
              {snapshot.truncated && <Notice title="Activity history is limited" body="Older records may be omitted. The explorer may have additional activity." />}
              {hiddenCount > 0 && <Text style={styles.muted}>{hiddenCount} zero-value token transaction{hiddenCount === 1 ? '' : 's'} hidden.</Text>}
              <Button title={snapshot.view.showZero ? 'Hide zero-value token activity' : 'Show zero-value token activity'} variant="secondary"
                onPress={() => { controller.setView({ showZero: !snapshot.view.showZero }); setOptionsOpen(false); }} />
              <Button title="Done" variant="quiet" onPress={() => setOptionsOpen(false)} />
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
              <Text style={s.detailAmount}>Copy this address?</Text>
              <Text style={styles.muted}>
                History can contain misleading or lookalike addresses. Compare
                the complete address with a trusted source before using it.
              </Text>
              <Text style={s.full}>{copyAddress}</Text>
              <Button
                title={copying ? 'Copying…' : 'Copy full address'}
                disabled={copying}
                onPress={copy}
              />
              <Button
                title="Cancel"
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
