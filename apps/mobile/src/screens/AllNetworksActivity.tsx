import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AccountActivityController, AccountActivityNetwork, AccountActivityRow } from '../activity/accountActivity';
import { useBalancePrivacy } from '../platform/balancePrivacy';
import { useNativeTranslation } from '../platform/localization';
import { Button, Card, Coin, colors, Header, Icon, IconButton, Notice, SegmentedControl, styles, Text } from '../ui';
import { ActivityListRow } from './ActivityListRow';
import { IdlePressable } from './IdleActivityBoundary';
import { NativeActivityScreen, nativeActivityRowPresentation } from './NativeActivity';
import { NetworkSourceSheet } from './NetworkSourceSheet';
import type { ShellLeafNavigation } from './RealAppShell';
import { activityAssetIcon } from '../activity/assetIcon';

export type AccountActivityAction = 'saved' | 'cancel' | 'cancel-saved' | 'speed-up';
export function AllNetworksActivity({ controller, accountLabel, navigation, onAction, initialTarget }: {
  controller: AccountActivityController;
  accountLabel: string;
  navigation?: ShellLeafNavigation;
  onAction?(entry: AccountActivityRow, action: AccountActivityAction, hash: string, assertCurrent: () => void): Promise<void>;
  initialTarget?: Readonly<{ networkId: string; hash: string }>;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { hidden } = useBalancePrivacy(), { t } = useNativeTranslation();
  const [selection, setSelection] = useState<AccountActivityRow | null>(null);
  const [savedNetwork, setSavedNetwork] = useState<AccountActivityNetwork | null>(null);
  const [sheet, setSheet] = useState<'filter' | 'options' | 'saved-networks' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const openSheet = (next: 'filter' | 'options' | 'saved-networks') => { setError(''); setSheet(next); };
  const lifetime = useRef({ alive: true, generation: 0, busy: false });
  const arrival = useRef('');
  const list = useRef<FlatList<AccountActivityRow>>(null);
  const scrollPosition = useRef({ key: '', offset: 0, height: 0, restore: false });
  const scrollKey = JSON.stringify([snapshot.accountId, snapshot.filter, snapshot.view.filter, snapshot.view.showZero]);
  useLayoutEffect(() => {
    if (scrollPosition.current.key === scrollKey) return;
    scrollPosition.current = { key: scrollKey, offset: 0, height: 0, restore: false };
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [scrollKey]);
  const rememberScroll = () => { scrollPosition.current.restore = true; scrollPosition.current.height = 0; };
  const restoreScroll = () => {
    const saved = scrollPosition.current;
    if (saved.key !== scrollKey || !saved.restore || !saved.height || !list.current) return;
    list.current.scrollToOffset({ offset: Math.min(saved.offset, saved.height), animated: false });
    saved.restore = false;
  };
  useLayoutEffect(() => controller.connect(), [controller]);
  useLayoutEffect(() => { const owner = lifetime.current; owner.alive = true; return () => { owner.alive = false; owner.generation++; }; }, []);
  const currentSelection = selection && controller.findRow(selection.choice.scope.network.id, selection.row.hash);
  const selected = currentSelection?.controller === selection?.controller ? currentSelection : undefined;
  const currentSavedNetwork = savedNetwork && controller.getNetwork(savedNetwork.choice.scope.network.id);
  const inventory = currentSavedNetwork?.controller === savedNetwork?.controller ? currentSavedNetwork : undefined;
  const targetNetworkId = initialTarget?.networkId, targetHash = initialTarget?.hash;
  useEffect(() => {
    let live = true;
    const update = () => {
      if (!live) return;
      if (!targetNetworkId || !targetHash) { arrival.current = ''; return; }
      const key = `${targetNetworkId}:${targetHash}`, current = controller.getSnapshot();
      if (arrival.current === key) return;
      if (current.status === 'ready' && current.filter !== 'all' && current.filter !== targetNetworkId &&
          current.choices.some(choice => choice.scope.network.id === targetNetworkId) && arrival.current !== `pending:${key}`) {
        arrival.current = `pending:${key}`;
        void controller.selectFilter(targetNetworkId).catch(() => { if (live) setError(t('mobile.activityViews.allNetworksActivity.activityCouldNotBeOpenedRefreshAndTryAgain')); });
        return;
      }
      const row = controller.findRow(targetNetworkId, targetHash);
      if (row) { arrival.current = key; scrollPosition.current.restore = true; scrollPosition.current.height = 0; setSelection(row); }
    };
    const unsubscribe = controller.subscribe(update);
    queueMicrotask(update);
    return () => { live = false; unsubscribe(); };
  }, [controller, targetNetworkId, targetHash, t]);
  const closeSheet = () => { lifetime.current.generation++; lifetime.current.busy = false; setBusy(false); setSheet(null); };
  const closeDetail = () => { lifetime.current.generation++; lifetime.current.busy = false; setBusy(false); setSelection(null); };
  const closeInventory = () => { lifetime.current.generation++; lifetime.current.busy = false; savedNetwork?.controller.closeSavedPending(); setBusy(false); setSavedNetwork(null); };
  useLayoutEffect(() => {
    if (selected || inventory) return;
    return navigation?.registerBack(() => { if (sheet) { closeSheet(); return true; } return false; });
  }, [navigation, selected, inventory, sheet]);
  const run = async (operation: (check: () => void) => Promise<void>) => {
    const owner = lifetime.current;
    if (!owner.alive || owner.busy || AppState.currentState !== 'active') return;
    const generation = ++owner.generation, accountId = snapshot.accountId;
    const check = () => { if (!owner.alive || owner.generation !== generation || AppState.currentState !== 'active' || controller.getSnapshot().accountId !== accountId) throw Error('Activity changed'); };
    owner.busy = true; setBusy(true); setError('');
    try { check(); await operation(check); check(); }
    catch { if (owner.alive && generation === owner.generation) setError(t('mobile.activityViews.allNetworksActivity.activityCouldNotBeOpenedRefreshAndTryAgain')); }
    finally { if (owner.alive && generation === owner.generation) { owner.busy = false; setBusy(false); } }
  };
  const present = (entry: AccountActivityRow) => nativeActivityRowPresentation(entry.row, {
    accountAddress: entry.choice.scope.accountAddress, nativeSymbol: entry.choice.symbol, networkName: entry.choice.networkName, hideBalances: hidden,
  });
  const detailSource = selected ?? inventory;
  const showingInventory = !selected && !!inventory;
  if (detailSource) {
    const action = onAction ? (kind: AccountActivityAction, hash: string) => { void run(async check => {
      const current = controller.getNetwork(detailSource.choice.scope.network.id);
      const child = detailSource.controller.getSnapshot();
      const row = child.savedPending?.rows.find(value => value.hash === hash) ?? child.rows.find(value => value.hash === hash);
      if (current?.controller !== detailSource.controller || !row || JSON.stringify(current.choice.scope) !== JSON.stringify(detailSource.choice.scope)) throw Error('Activity scope changed');
      await onAction({ ...detailSource, key: `${JSON.stringify(detailSource.choice.scope)}:${hash}`, row }, kind, hash, check);
    }); } : undefined;
    return <View style={s.root}><NativeActivityScreen key={selected?.key ?? JSON.stringify(detailSource.choice.scope)} controller={detailSource.controller} accountLabel={accountLabel}
      externallyConnected detailOnly={!!selected} savedPendingOnly={showingInventory} initialHash={selected?.row.hash} navigation={navigation}
      onBack={showingInventory ? closeInventory : closeDetail} onNavigateToReview={action} />
      {busy && <Text accessibilityLiveRegion="polite" style={s.actionFeedback}>{t('mobile.activityViews.allNetworksActivity.openingTransfer')}</Text>}
      {!!error && <Notice title={t('mobile.activityViews.allNetworksActivity.couldNotOpenTransfer')} body={error} tone="amber" />}
    </View>;
  }
  const savedNetworks = snapshot.choices.filter(choice => controller.getNetwork(choice.scope.network.id)?.controller.getSnapshot().canViewSavedPending);
  const openSavedPending = (networkId: string) => {
    if (!lifetime.current.alive || AppState.currentState !== 'active') return;
    const current = controller.getNetwork(networkId);
    if (!current?.controller.getSnapshot().canViewSavedPending) return;
    rememberScroll(); setError(''); setSavedNetwork(current); setSheet(null);
  };
  const filterChoice = snapshot.choices.find(choice => choice.scope.network.id === snapshot.filter);
  const filterName = snapshot.filter === 'all' ? t('mobile.accountPortfolio.allNetworks') : filterChoice?.networkName ?? t('mobile.accountPortfolio.unavailableNetwork');
  const unavailableNetworks = snapshot.choices.filter(choice => {
    const child = controller.getNetwork(choice.scope.network.id)?.controller.getSnapshot();
    return child?.status === 'unavailable' || child?.status === 'ready' && !child.loadingMore &&
      (!!child.error || child.discoveryAvailable === false);
  }).map(choice => choice.networkName);
  return <SafeAreaView edges={navigation ? ['top'] : ['top', 'bottom']} style={s.root}>
    <View style={s.header}><Header title={t('buttons.activity')} subtitle={accountLabel} right={<View style={s.toolbar}>
      <IconButton label={t('mobile.activityViews.nativeActivity.refreshActivity')} icon="refresh" disabled={busy || snapshot.refreshing || snapshot.status === 'loading'} onPress={() => void run(async () => { await controller.refresh(); })} />
      <IconButton label={t('mobile.activityViews.nativeActivity.activityOptions')} icon="settings" selected={sheet === 'options'} onPress={() => openSheet('options')} />
    </View>} /></View>
    <FlatList ref={list} testID="account-activity-list" data={snapshot.rows} keyExtractor={entry => entry.key} contentContainerStyle={s.content}
      scrollEventThrottle={16} onScroll={event => { if (!scrollPosition.current.restore) scrollPosition.current.offset = event.nativeEvent.contentOffset.y; }}
      onLayout={restoreScroll} onContentSizeChange={(_width, height) => { scrollPosition.current.height = height; restoreScroll(); }}
      ListHeaderComponent={<View style={s.section}>
        <IdlePressable accessibilityRole="button" accessibilityLabel={t('mobile.activityViews.allNetworksActivity.networkFilterLabel', { network: filterName })} disabled={busy || snapshot.status === 'loading'} onPress={() => openSheet('filter')} style={s.filter}>
          <View style={s.filterChoice}>
            <View testID={`activity-filter-icon-${filterChoice?.scope.network.id ?? 'all'}`} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {filterChoice ? <Coin id={filterChoice.scope.network.id} fallbackSymbol={filterChoice.symbol} size={18} /> : <Icon name="globe" size={18} color={colors.blue} />}
            </View>
            <Text style={s.filterLabel}>{filterName}</Text>
          </View><Icon name="chevron-down" size={18} color={colors.muted} />
        </IdlePressable>
        <SegmentedControl label={t('mobile.activityViews.nativeActivity.activityFilter')} value={snapshot.view.filter}
          options={[{ value: 'all', label: t('mobile.activityViews.nativeActivity.all') }, { value: 'sent', label: t('send.sent') }, { value: 'received', label: t('send.received') }]}
          onChange={filter => { void controller.setView({ filter, anchor: null, offset: 0 }); list.current?.scrollToOffset({ offset: 0 }); }} />
        <Text style={s.caption}>{t('mobile.activityViews.nativeActivity.recentActivity')}</Text>
        {(snapshot.status === 'loading' || snapshot.refreshing) && <ActivityIndicator accessibilityLabel={t('mobile.activityViews.nativeActivity.loadingActivity')} color={colors.pink} />}
        {!!(snapshot.error || error) && <Notice title={t('mobile.activityViews.nativeActivity.someActivityIsUnavailable')}
          body={error || (unavailableNetworks.length ? t('mobile.activityViews.allNetworksActivity.unavailableOn', { networks: unavailableNetworks.join(', ') }) : snapshot.error || undefined)} tone="amber" />}
      </View>}
      renderItem={({ item, index }) => {
        const display = present(item), previous = snapshot.rows[index - 1], next = snapshot.rows[index + 1];
        const first = !previous || present(previous).date.key !== display.date.key, last = !next || present(next).date.key !== display.date.key;
        return <ActivityListRow testID={`account-activity-row-${item.choice.scope.network.id}-${item.row.hash}`} first={first} last={last}
          heading={first ? display.date.label : undefined} title={display.title} subtitle={`${display.status}${item.row.unavailable ? ` · ${t('mobile.activityViews.nativeActivity.detailsUnavailable')}` : ''}`}
          networkBadge={snapshot.filter === 'all' ? item.choice.networkName : undefined} networkId={item.choice.scope.network.id} networkSymbol={item.choice.symbol}
          direction={display.direction} amount={display.amount} time={display.date.time}
          asset={activityAssetIcon(item.row, String(item.choice.scope.network.chainId), 'registrationHash' in item.choice.scope.network ? item.choice.scope.network.registrationHash : undefined)}
          registrationHash={'registrationHash' in item.choice.scope.network ? item.choice.scope.network.registrationHash : undefined} assetSymbol={item.row.display?.displaySymbol ?? item.row.local?.token?.symbol}
          label={t('mobile.activityViews.allNetworksActivity.networkRowLabel', { description: display.label, network: item.choice.networkName })} disabled={busy} onPress={() => { rememberScroll(); setError(''); setSelection(item); }} />;
      }}
      ListEmptyComponent={snapshot.status !== 'loading' && !snapshot.refreshing ? <View style={s.empty}>
        <Text style={s.emptyTitle}>{snapshot.status === 'unavailable' ? t('mobile.activity.unavailableTitle') : t('mobile.activityViews.nativeActivity.noActivityToShow')}</Text>
        <Text style={s.caption}>{t('mobile.activityViews.nativeActivity.refreshOrChooseAnotherFilter')}</Text>
      </View> : undefined}
      ListFooterComponent={<View style={s.section}>{snapshot.hasMore && !snapshot.refreshing && <Button title={snapshot.loadingMore ? t('mobile.activityViews.nativeActivity.loadingOlderActivity') : snapshot.partial ? t('mobile.activityViews.allNetworksActivity.retryActivity') : t('mobile.activityViews.nativeActivity.loadOlderActivity')} variant="secondary" size="compact"
        disabled={busy || snapshot.loadingMore} onPress={() => void run(async () => { await controller.loadMore(); })} />}</View>} />
    <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={closeSheet}>
      {sheet === 'filter' || sheet === 'saved-networks' ? <NetworkSourceSheet purpose="filter" overContent busy={busy} selectedId={sheet === 'filter' ? snapshot.filter ?? '' : ''}
        error={error ? t('mobile.accountPortfolio.error') : undefined}
        title={sheet === 'saved-networks' ? t('mobile.activityViews.nativeActivity.savedPending') : undefined}
        options={sheet === 'saved-networks' ? savedNetworks.map(choice => ({ id: choice.scope.network.id, name: choice.networkName, symbol: choice.symbol }))
          : [{ id: 'all', name: t('mobile.accountPortfolio.allNetworks'), symbol: '' }, ...snapshot.choices.map(choice => ({ id: choice.scope.network.id, name: choice.networkName, symbol: choice.symbol }))]}
        onSelect={id => { if (sheet === 'saved-networks') openSavedPending(id); else void run(async check => { await controller.selectFilter(id); check(); setSheet(null); }); }} onClose={closeSheet} />
        : <View style={s.modal}><Card style={s.options}><Text style={s.emptyTitle}>{t('mobile.activityViews.nativeActivity.activityOptions')}</Text>
          {savedNetworks.length > 0 && <Button title={t('mobile.activityViews.nativeActivity.savedPending')} icon="clock" variant="secondary" onPress={() => {
            if (snapshot.filter && snapshot.filter !== 'all') openSavedPending(snapshot.filter); else openSheet('saved-networks');
          }} />}
          <Button title={snapshot.view.showZero ? t('mobile.activityViews.nativeActivity.hideZerovalueTokenActivity') : t('mobile.activityViews.nativeActivity.showZerovalueTokenActivity')} variant="secondary" onPress={() => { void controller.setView({ showZero: !snapshot.view.showZero }); setSheet(null); }} />
          <Button title={t('buttons.close')} variant="quiet" onPress={closeSheet} />
        </Card></View>}
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, header: { paddingHorizontal: 16 }, toolbar: { flexDirection: 'row' },
  content: { paddingHorizontal: 16, paddingBottom: 24 }, section: { gap: 10, paddingVertical: 8 },
  filter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 13, borderRadius: 12, backgroundColor: colors.surface },
  filterChoice: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  filterLabel: { fontSize: 14, fontWeight: '500', flexShrink: 1 }, caption: { ...styles.muted, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 }, emptyTitle: { fontSize: 18, fontWeight: '600' },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008', padding: 16 }, options: { gap: 16, padding: 20 },
  actionFeedback: { ...styles.muted, textAlign: 'center', padding: 12 },
});
