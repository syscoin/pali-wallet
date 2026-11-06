import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { formatSyscoinTokenAmount } from '../../../../source/shared/utxoTokenAmounts';
import { formatBaseUnits } from '../core/amounts';
import { UtxoWatchActivity, type UtxoActivityContext, type UtxoActivityRow } from '../core/utxoActivity';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import type { ShellLeafNavigation } from './RealAppShell';
import { Button, Card, colors, Header, Notice, styles, Text } from '../ui';

function signed(units: string, decimals: number, symbol: string): string {
  const negative = units.startsWith('-');
  return `${negative ? '−' : units === '0' ? '' : '+'}${formatBaseUnits(negative ? units.slice(1) : units, decimals)} ${symbol}`;
}
function assetQuantity(row: UtxoActivityRow): string | null {
  const value = row.assetAmount;
  if (!value) return null;
  const formatted = formatSyscoinTokenAmount(value.amount, value.decimals);
  if (formatted === null) return null;
  const direction = value.direction === 'sent' ? '−' : value.direction === 'received' ? '+' : '';
  return `${direction}${formatted} ${value.symbol ?? 'SPT'}`;
}
/** The active screen follows the account-owned history capability. */
export function WatchActivity({ authority, navigation, onBack }: {
  authority: WatchOnlyAuthority; navigation: ShellLeafNavigation; onBack(): void;
}) {
  const lifetime = useRef({ alive: true, busy: false, action: 0, selected: null as string | null, pending: null as object | null });
  const controller = useMemo(() => new UtxoWatchActivity(authority, () => AppState.currentState === 'active'), [authority]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirmationOwner, setConfirmationOwner] = useState<UtxoActivityContext | null>(null);
  const [busy, setBusy] = useState(false);
  const selectTransaction = useCallback((txid: string | null) => {
    lifetime.current.selected = txid;
    lifetime.current.action++;
    setSelected(txid); setFeedback(''); setConfirmationOwner(null);
    if (txid) controller.selectDetail(txid); else controller.clearDetail();
  }, [controller]);
  const list = useRef<FlatList<UtxoActivityRow>>(null);
  const summaryChosen = state.rows.find((row) => row.txid === selected);
  const detail = state.detail?.txid === selected ? state.detail : null;
  const chosen = detail?.row ?? summaryChosen;
  const network = state.context ? authority.getNetwork(state.context.networkId) : null;
  const account = authority.getSnapshot().accounts.find((row) => row.id === state.context?.accountId);
  useLayoutEffect(() => {
    const life = lifetime.current; life.alive = true;
    let observedContext = '';
    const clear = controller.subscribe(() => {
      const value = controller.getSnapshot();
      const key = value.context ? `${value.context.accountId}:${value.context.networkId}:${value.context.address}:${value.context.generation}` : '';
      if (value.status === 'idle' || key !== observedContext) {
        selectTransaction(null); setBusy(false); life.busy = false; life.pending = null;
      } else if (value.status === 'loading') {
        setConfirmationOwner(null);
      }
      observedContext = key;
    });
    controller.activate();
    const revoke = () => { selectTransaction(null); life.busy = false; life.pending = null; setBusy(false); controller.revoke(); };
    const change = AppState.addEventListener('change', (value) => { if (value !== 'active') revoke(); else controller.setFocused(true); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { controller.setFocused(false); revoke(); }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { controller.setFocused(true); }) : null;
    return () => { life.alive = false; life.action++; life.selected = null; life.pending = null; clear(); controller.dispose(); change.remove(); blur?.remove(); focus?.remove(); };
  }, [controller, selectTransaction]);
  useLayoutEffect(() => navigation.registerBack(() => { if (chosen) selectTransaction(null); else onBack(); return true; }), [navigation, chosen, onBack, selectTransaction]);
  useLayoutEffect(() => navigation.registerLeave((navigate) => { controller.revoke(); navigate(); }), [navigation, controller]);
  useLayoutEffect(() => { navigation.setImmersive(!!chosen); return () => navigation.setImmersive(false); }, [navigation, chosen]);
  const back = () => { if (chosen) selectTransaction(null); else onBack(); };
  const act = async (kind: 'copy' | 'explorer') => {
    const life = lifetime.current;
    if (!chosen || !network || !life.alive || life.busy || !controller.isCurrent()) return;
    const context = state.context, row = chosen, summary = summaryChosen, action = ++life.action, pending = {};
    life.pending = pending; life.busy = true; setBusy(true); setFeedback('');
    const current = () => life.alive && life.pending === pending && action === life.action && life.selected === row.txid &&
      controller.isCurrent(context) && !!summary && controller.getSnapshot().rows.includes(summary);
    try {
      if (!current()) return;
      if (kind === 'copy') { if (await Clipboard.setStringAsync(row.txid) === false) throw Error(); }
      else if (context) {
        const explorer = authority.getUtxoExplorer(context.networkId).replace(/\/$/, '') + '/';
        await Linking.openURL(new URL(`tx/${row.txid}`, explorer).href);
      }
      if (current()) setFeedback(kind === 'copy' ? 'Transaction ID copied.' : 'Explorer opened.');
    } catch { if (current()) setFeedback(kind === 'copy' ? 'Could not copy the transaction ID.' : 'Could not open the explorer.'); }
    finally {
      // A dispatched action still drains after Back/Refresh. Only its owner may
      // release admission; feedback additionally requires the same selected row.
      if (life.pending === pending) { life.pending = null; life.busy = false; if (life.alive) setBusy(false); }
    }
  };
  const refresh = async () => {
    const life = lifetime.current, { context, status } = controller.getSnapshot();
    if (!life.alive || !context || status === 'loading' || !controller.isCurrent(context)) return;
    selectTransaction(null);
    const action = life.action;
    list.current?.scrollToOffset({ offset: 0, animated: false });
    const confirmation = await controller.refresh();
    if (life.alive && life.action === action && confirmation?.consume()) setConfirmationOwner(context);
  };
  const units = (value: string | null) => value === null || !network ? 'Unavailable' : `${formatBaseUnits(value, network.decimals)} ${network.symbol}`;
  const net = (value: string | null) => value === null || !network ? 'Unavailable' : signed(value, network.decimals, network.symbol);
  const status = (row: UtxoActivityRow) => row.block === null
    ? 'Pending'
    : `${row.observedConfirmations} confirmation${row.observedConfirmations === 1 ? '' : 's'} · Block ${row.block.height}`;
  const detailAmount = chosen?.hasAssetData
    ? assetQuantity(chosen) ?? 'Asset amount unavailable'
    : chosen?.nativeTransfer
      ? `${chosen.nativeTransfer.direction === 'sent' ? '−' : chosen.nativeTransfer.direction === 'received' ? '+' : ''}${units(chosen.nativeTransfer.amount)}`
      : chosen ? net(chosen.netUnits) : '';
  return <SafeAreaView edges={chosen ? ['top', 'bottom'] : ['top']} style={s.root}>
    <View style={s.header}><Header title={chosen ? 'Transaction details' : 'Activity'} subtitle={`${account?.name ?? 'Watch account'} · ${network?.name ?? 'Public account'}`} onBack={back} /></View>
    {!network || !state.context ? <ScrollView contentContainerStyle={s.content}><Notice title="Activity unavailable" body="Choose an account to view its activity." /></ScrollView> : <View style={s.body}>
      <View aria-hidden={!!chosen} accessibilityElementsHidden={!!chosen} importantForAccessibility={chosen ? 'no-hide-descendants' : 'auto'} pointerEvents={chosen ? 'none' : 'auto'} style={[s.list, chosen && s.obscured]}>
        <FlatList ref={list} testID="watch-activity-list" data={state.rows} keyExtractor={(row) => row.txid} contentContainerStyle={s.content}
          ListHeaderComponent={<View style={s.section}>
            {(state.status === 'unavailable' || state.status === 'stale') && <Notice title={state.status === 'stale' ? 'Could not refresh activity' : 'Activity unavailable'} body={state.status === 'stale' ? 'Showing previously loaded activity. Try refreshing again.' : 'Activity could not be loaded. Try again.'} tone="amber" />}
            <View>
              <Button title={state.status === 'unavailable' ? 'Try again' : 'Refresh activity'} variant="secondary" disabled={!!chosen || state.status === 'loading'} onPress={() => void refresh()} />
              <View role="status" accessibilityLiveRegion="polite">
                {confirmationOwner === state.context && state.status === 'ready' && (
                  <Text style={[styles.muted, s.confirmation]}>Explorer reports a transaction now has confirmations.</Text>
                )}
              </View>
            </View>
            {state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading activity" color={colors.pink} />}
          </View>}
          renderItem={({ item }) => <View testID={`watch-activity-row-${item.txid}`} style={s.row}><Button title={item.hasAssetData ? assetQuantity(item) ?? 'Asset activity' : item.netUnits === null ? 'Amount unavailable' : `Net change ${net(item.netUnits)}`} variant="quiet" disabled={!!chosen || state.status === 'loading'} onPress={() => { if (controller.isCurrent()) selectTransaction(item.txid); }} />
            {item.hasAssetData && <Text style={styles.muted}>Native account change: {net(item.netUnits)}</Text>}
            <Text style={styles.muted}>{status(item)}</Text>
            <Text style={s.hash}>{item.txid.slice(0, 12)}…{item.txid.slice(-8)}</Text>
          </View>}
          ListEmptyComponent={state.status === 'ready' ? <Notice title="No activity yet" body="There are no transactions to show for this account." /> : undefined}
          ListFooterComponent={<View style={s.section}>
            {state.status === 'ready' && (state.hasNewer || state.hasMore) && <View style={s.pageActions}>
              {state.hasNewer && <Button title="Newer activity" disabled={!!chosen} variant="secondary" style={s.pageButton} onPress={() => { selectTransaction(null); list.current?.scrollToOffset({ offset: 0, animated: false }); void controller.loadNewer(); }} />}
              {state.hasMore && <Button title="Older activity" disabled={!!chosen} variant="secondary" style={s.pageButton} onPress={() => void controller.loadMore()} />}
            </View>}
            {state.rows.length > 0 && <Text style={styles.muted}>{state.rows.length} transactions shown{state.windowed ? ` · Pages ${state.firstPage}–${state.page}` : ''}</Text>}
          </View>} />
      </View>
      {chosen && <ScrollView testID="watch-activity-detail" style={s.detailOverlay} contentContainerStyle={s.content}>
        <Text style={s.amount}>{detailAmount}</Text>
        <Text style={styles.muted}>{chosen.hasAssetData ? chosen.assetAmount ? chosen.assetAmount.scope === 'account' ? 'Account asset amount' : 'Asset operation amount' : 'Asset quantity unavailable' : chosen.nativeTransfer ? chosen.nativeTransfer.kind === 'self' ? 'Native self-transfer' : 'Native transfer' : 'Native account change'}</Text>
        {state.status === 'stale' && <Notice title="Previously loaded activity" body="Refresh the list to check this transaction again." tone="amber" />}
        {detail?.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading transaction details" color={colors.pink} />}
        {detail?.status === 'unavailable' && <View style={s.section}>
          <Text style={styles.muted}>Couldn’t load full details.</Text>
          <Button title="Try again" variant="secondary" onPress={() => controller.retryDetail()} />
        </View>}
        <Card style={s.detail}>
          <Text style={s.label}>TRANSACTION ID</Text><Text selectable style={s.hash}>{chosen.txid}</Text>
          {chosen.assetAmount?.assetGuid && <><Text style={s.label}>ASSET ID</Text><Text selectable style={s.hash}>{chosen.assetAmount.assetGuid}</Text></>}
          <Text style={s.label}>ACCOUNT</Text><Text>{account?.name ?? 'Watch account'}</Text>
          {detail?.status === 'ready' && detail.from.length > 0 && <><Text style={s.label}>FROM</Text>{detail.from.map((address) => <Text key={address} selectable style={s.hash}>{address}</Text>)}</>}
          {detail?.status === 'ready' && detail.to.length > 0 && <><Text style={s.label}>TO</Text>{detail.to.map((address) => <Text key={address} selectable style={s.hash}>{address}</Text>)}</>}
          <Text>Native account change: {net(chosen.netUnits)}</Text>
          <Text>Received by this account: {units(chosen.receivedUnits)}</Text>
          <Text>Spent from this account: {units(chosen.spentUnits)}</Text>
          <Text>Whole transaction fee: {units(chosen.transactionFeeUnits)}</Text>
          <Text style={styles.muted}>The fee may include inputs from other accounts.</Text>
          <Text>{status(chosen)}</Text>
          {chosen.block?.timestamp != null && <Text>Block time: {new Date(chosen.block.timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Text>}
        </Card>
        {busy && <ActivityIndicator accessibilityLabel="Completing transaction action" color={colors.pink} />}
        <Button title="Copy transaction ID" variant="secondary" disabled={busy} onPress={() => void act('copy')} />
        <Button title="Open transaction in explorer" variant="quiet" disabled={busy} onPress={() => void act('explorer')} />
        {!!feedback && <Text accessibilityLiveRegion="polite" style={styles.muted}>{feedback}</Text>}
      </ScrollView>}
    </View>}
  </SafeAreaView>;
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, header: { paddingHorizontal: 24 }, body: { flex: 1, minHeight: 0 }, list: { flex: 1 }, obscured: { opacity: 0 }, detailOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg },
  pageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, pageButton: { flexGrow: 1 }, content: { paddingHorizontal: 24, paddingBottom: 28, gap: 16 }, section: { gap: 14, paddingVertical: 12 }, row: { gap: 8, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  confirmation: { marginTop: 10 }, hash: { color: colors.text, fontSize: 13, lineHeight: 21 }, amount: { color: colors.text, fontSize: 26, lineHeight: 36 }, detail: { padding: 18, gap: 14 }, label: { color: colors.muted, fontSize: 11, letterSpacing: 1 } });
