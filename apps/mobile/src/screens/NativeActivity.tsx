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
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, colors, Header, Notice, styles, Text } from '../ui';
import { formatBaseUnits } from '../core/amounts';
import type {
  ActivityRow,
  NativeActivity,
  NativeActivitySnapshot,
} from '../activity/nativeActivity';

const status = (row: ActivityRow) =>
  row.observation?.status === 'finalized'
    ? 'Confirmed'
    : row.observation?.status === 'finalized-reverted'
    ? 'Reverted · finalized'
    : row.observation?.status === 'included'
    ? 'Included · awaiting finality'
    : row.observation?.status === 'reverted'
    ? 'Reverted · awaiting finality'
    : row.observation?.status === 'pending'
    ? 'Pending'
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
function direction(
  row: ActivityRow,
  owner: string
): 'sent' | 'received' | 'self' | 'unknown' {
  if (row.local)
    return row.local.recipient.toLowerCase() === owner.toLowerCase()
      ? 'self'
      : 'sent';
  const tx = row.observation;
  if (!tx) return 'unknown';
  const incoming =
    tx.to?.toLowerCase() === owner.toLowerCase() ||
    tx.events.some((event) => event.to.toLowerCase() === owner.toLowerCase());
  const outgoing =
    tx.from.toLowerCase() === owner.toLowerCase() ||
    tx.events.some((event) => event.from.toLowerCase() === owner.toLowerCase());
  return incoming && outgoing
    ? 'self'
    : outgoing
    ? 'sent'
    : incoming
    ? 'received'
    : 'unknown';
}
function zeroOnly(row: ActivityRow) {
  return (
    !row.local &&
    row.observation &&
    row.observation.valueUnits === '0' &&
    row.observation.events.length > 0 &&
    row.observation.events.every((event) => event.amountUnits === '0')
  );
}
function amount(row: ActivityRow): string {
  if (row.local)
    return `${formatBaseUnits(
      row.local.amountUnits,
      row.local.token?.decimals ?? 18
    )} ${row.local.token?.symbol ?? 'ETH'}`;
  if (!row.observation)
    return row.candidate?.tokenHint ? 'ERC20 activity' : 'Ethereum activity';
  if (row.observation.events.length)
    return `${row.observation.events.length} token transfer event${
      row.observation.events.length === 1 ? '' : 's'
    }`;
  return `${formatBaseUnits(row.observation.valueUnits, 18)} ETH`;
}

export function NativeActivityScreen({
  controller,
  accountLabel,
  onBack,
}: {
  controller: NativeActivity;
  accountLabel: string;
  onBack(): void;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useLayoutEffect(() => controller.connect(), [controller]);
  return (
    <NativeActivityContent
      key={snapshot.accountAddress ?? 'locked'}
      controller={controller}
      snapshot={snapshot}
      accountLabel={accountLabel}
      onBack={onBack}
    />
  );
}
function NativeActivityContent({
  controller,
  snapshot,
  accountLabel,
  onBack,
}: {
  controller: NativeActivity;
  snapshot: NativeActivitySnapshot;
  accountLabel: string;
  onBack(): void;
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
  const visibleItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: ActivityRow }[] }) => {
      firstVisible.current = viewableItems[0]?.item.hash ?? null;
      controller.observeVisible(viewableItems.map((item) => item.item.hash));
    },
    [controller]
  );
  useLayoutEffect(() => {
    const local = lifetime.current;
    return () => {
      local.epoch++;
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, []);
  const owner = snapshot.accountAddress ?? '';
  const rows = snapshot.rows.filter(
    (row) =>
      (snapshot.view.showZero || !zeroOnly(row)) &&
      (snapshot.view.filter === 'all' ||
        direction(row, owner) === 'unknown' ||
        direction(row, owner) === snapshot.view.filter)
  );
  const chosen = snapshot.rows.find((row) => row.hash === selected);
  const hiddenCount = snapshot.rows.filter((row) => zeroOnly(row)).length;
  const savePosition = async (): Promise<void> => {
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
    if (navigating.current) return;
    navigating.current = true;
    const captured = lifetime.current.epoch;
    try {
      await savePosition();
      if (lifetime.current.epoch === captured) navigate();
    } finally {
      navigating.current = false;
    }
  };
  const close = () => {
    setCopyAddress(null);
    if (selected) setSelected(null);
    else {
      void afterPositionSaved(onBack);
    }
  };
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
    <SafeAreaView edges={['top', 'bottom']} style={s.root}>
      <View style={s.header}>
        <Header
          title={chosen ? 'Transaction details' : 'Activity'}
          subtitle={`${accountLabel} · Ethereum`}
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
              {snapshot.truncated && (
                <Notice
                  title="Recent activity saved on this device"
                  body="Older local records have been pruned. Load indexed history for older transactions; unavailable explorer data may leave gaps."
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
            <Pressable
              ref={(node) => {
                if (node) rowViews.current.set(item.hash, node);
                else rowViews.current.delete(item.hash);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${amount(item)}, ${status(
                item
              )}. View transaction details`}
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
                <Text style={s.amount}>{amount(item)}</Text>
                <Text style={s.direction}>
                  {direction(item, owner) === 'unknown'
                    ? 'Activity'
                    : direction(item, owner)}
                </Text>
              </View>
              <Text style={styles.muted}>{status(item)}</Text>
              <Text style={s.hash}>
                {item.hash.slice(0, 12)}…{item.hash.slice(-8)}
              </Text>
              {item.unavailable && (
                <Text style={styles.muted}>RPC details unavailable</Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            snapshot.status !== 'loading' ? (
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
              {snapshot.hasMore && (
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
          <Text style={s.detailAmount}>{amount(chosen)}</Text>
          <Text style={styles.muted}>{status(chosen)}</Text>
          {chosen.local?.token && (
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
              {chosen.observation?.from ??
                (chosen.local ? owner : 'Not verified')}
            </Text>
            {!!(chosen.observation?.from ?? (chosen.local ? owner : null)) && (
              <Button
                title="Copy sender address"
                variant="quiet"
                onPress={() =>
                  setCopyAddress(chosen.observation?.from ?? owner)
                }
              />
            )}
            <Text style={s.label}>
              {chosen.local?.token ? 'APPROVED TOKEN RECIPIENT' : 'TO'}
            </Text>
            <Text style={s.full}>
              {chosen.local?.recipient ??
                chosen.observation?.to ??
                'Not verified or contract creation'}
            </Text>
            {!!(chosen.local?.recipient ?? chosen.observation?.to) && (
              <Button
                title="Copy recipient address"
                variant="quiet"
                onPress={() =>
                  setCopyAddress(
                    chosen.local?.recipient ?? chosen.observation?.to ?? null
                  )
                }
              />
            )}
            {chosen.local?.token && (
              <>
                <Text style={s.label}>TOKEN CONTRACT</Text>
                <Text style={s.full}>{chosen.local.token.contractAddress}</Text>
              </>
            )}
            <Text style={s.label}>NETWORK FEE</Text>
            <Text>
              {chosen.observation?.feeUnits
                ? `${formatBaseUnits(chosen.observation.feeUnits, 18)} ETH`
                : 'Actual fee not verified'}
            </Text>
            {chosen.observation?.block && (
              <>
                <Text style={s.label}>BLOCK</Text>
                <Text>{chosen.observation.block.number}</Text>
              </>
            )}
          </Card>
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
