import { IdlePressable } from './IdleActivityBoundary';
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
import { Button, Card, colors, Header, Notice, styles, Text } from '../ui';
import { formatBaseUnits } from '../core/amounts';
import { formatTokenUnits } from '../../../../source/shared/erc20';
import { getEvmHistoryDirection } from '../../../../source/shared/evmHistory';
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
}: {
  controller: NativeActivity;
  accountLabel: string;
  onBack(): void;
  navigation?: ShellLeafNavigation;
  onReplay?(hash: string): void;
  onCancelPending?(hash: string): void;
  onCancelSaved?(hash: string): void;
  onSpeedUpPending?(hash: string): void;
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
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copyAddress, setCopyAddress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const lifetime = useRef({ epoch: 0 });
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
              <Text style={styles.muted}>{snapshot.coverage}</Text>
              <View style={s.filters}>
                {(['all', 'sent', 'received'] as const).map((filter) => (
                  <Button
                    key={filter}
                    title={
                      filter === 'all'
                        ? 'All activity'
                        : filter === 'sent'
                        ? 'Sent'
                        : 'Received'
                    }
                    variant={
                      snapshot.view.filter === filter ? 'primary' : 'secondary'
                    }
                    onPress={() => {
                      controller.setView({ filter, anchor: null, offset: 0 });
                      list.current?.scrollToOffset({ offset: 0 });
                    }}
                  />
                ))}
              </View>
              {snapshot.canViewSavedPending && <Button title="Saved pending" variant="quiet"
                onPress={() => void afterPositionSaved(() => {
                  setFeedback('');
                  list.current?.scrollToOffset({ offset: 0, animated: false });
                  void controller.loadSavedPending();
                })} />}
              {snapshot.truncated && (
                <Notice
                  title="Activity history is limited"
                  body="This view and its saved history have limits. Older records may be omitted; the explorer may have additional indexed activity."
                />
              )}
              {!!snapshot.error && (
                <Notice
                  title="Some activity is unavailable"
                  body={snapshot.error}
                  tone="amber"
                />
              )}
              <Button
                title="Refresh activity"
                variant="quiet"
                disabled={snapshot.status === 'loading' || snapshot.loadingMore}
                onPress={() => {
                  restored.current = false;
                  void controller.refresh();
                }}
              />
              {snapshot.status === 'loading' && (
                <ActivityIndicator
                  accessibilityLabel="Loading activity"
                  color={colors.pink}
                />
              )}
              {hiddenCount > 0 && (
                <Text style={styles.muted}>
                  {hiddenCount} zero-value token transaction
                  {hiddenCount === 1 ? '' : 's'} hidden.
                </Text>
              )}
              <Button
                title={
                  snapshot.view.showZero
                    ? 'Hide zero-value token activity'
                    : 'Show zero-value token activity'
                }
                variant="quiet"
                onPress={() =>
                  controller.setView({ showZero: !snapshot.view.showZero })
                }
              />
            </View>
          }
          renderItem={({ item }) => (
            <IdlePressable
              ref={(node) => {
                if (node) rowViews.current.set(item.hash, node);
                else rowViews.current.delete(item.hash);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${amount(
                item,
                snapshot.nativeSymbol ?? 'ETH'
              )}, ${displayStatus(item)}. View transaction details`}
              onPress={() =>
                afterPositionSaved(() => {
                  setFeedback('');
                  setSelected(item.hash);
                  controller.inspect(item.hash);
                })
              }
              style={s.item}
            >
              <View style={s.itemHeader}>
                <Text style={s.amount}>
                  {amount(item, snapshot.nativeSymbol ?? 'ETH')}
                </Text>
                <Text style={s.direction}>
                  {direction(item, owner) === 'unknown'
                    ? 'Activity'
                    : direction(item, owner)}
                </Text>
              </View>
              <Text style={styles.muted}>{displayStatus(item)}</Text>
              <Text style={s.hash}>
                {item.hash.slice(0, 12)}…{item.hash.slice(-8)}
              </Text>
              {item.unavailable && (
                <Text style={styles.muted}>RPC details unavailable</Text>
              )}
            </IdlePressable>
          )}
          ListEmptyComponent={
            savedPending ? savedPending.status === 'ready' ? <Notice title="No saved pending transfers" /> : undefined : snapshot.status !== 'loading' ? (
              <Notice
                title={
                  snapshot.status === 'unavailable'
                    ? 'Activity unavailable'
                    : snapshot.error
                    ? 'Activity could not be loaded'
                    : 'No activity in the loaded history'
                }
                body="This list is not a balance or a complete account history. Refresh or load more to check for additional activity."
              />
            ) : undefined
          }
          ListFooterComponent={
            <View style={s.section}>
              {savedPending ? savedPending.hasMore && savedPending.status !== 'loading' && (
                <Button title={savedPending.status === 'unavailable' ? 'Try again' : 'Load more saved transfers'}
                  variant="secondary" onPress={() => void controller.loadSavedPending()} />
              ) : snapshot.hasMore && (
                <Button
                  title={
                    snapshot.loadingMore
                      ? 'Loading older activity…'
                      : 'Load older activity'
                  }
                  variant="secondary"
                  disabled={snapshot.loadingMore}
                  onPress={() => controller.loadMore()}
                />
              )}
              <Text style={s.build}>Development build · Use a test wallet</Text>
            </View>
          }
        />
      </View>
      {chosen && (
        <ScrollView contentContainerStyle={s.content}>
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
  header: { paddingHorizontal: 24 },
  list: { flex: 1 },
  hidden: { display: 'none' },
  content: { paddingHorizontal: 24, paddingBottom: 28, gap: 16 },
  section: { gap: 14, paddingVertical: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: {
    paddingVertical: 20,
    gap: 7,
    borderBottomWidth: 1,
    borderColor: colors.border,
    minHeight: 100,
  },
  itemHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  amount: { fontSize: 18, fontWeight: '600', flexShrink: 1 },
  direction: { color: colors.muted, fontSize: 13, textTransform: 'capitalize' },
  hash: { color: colors.muted, fontSize: 12 },
  detail: { padding: 20, gap: 12 },
  detailAmount: { fontSize: 24, fontWeight: '600' },
  full: { fontSize: 14, lineHeight: 23, color: colors.text },
  label: { fontSize: 11, color: colors.muted, letterSpacing: 1 },
  build: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)' },
  modalContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  confirm: { padding: 24, gap: 20 },
});
