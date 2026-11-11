import { HIDDEN_BALANCE, useBalancePrivacy } from '../platform/balancePrivacy';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { formatSyscoinTokenAmount } from '../../../../source/shared/utxoTokenAmounts';
import { formatBaseUnits } from '../core/amounts';
import type { SentryNodeObservation } from '../../../../source/shared/sentryNodeLookup';
import { UtxoActivity, type UtxoActivityContext, type UtxoActivityOwner, type UtxoActivityRow } from '../core/utxoActivity';
import type { UtxoNetwork } from '../core/utxoNetworks';
import type { ShellLeafNavigation } from './RealAppShell';
import { Button, Card, colors, Header, IconButton, Notice, SegmentedControl, styles, Text } from '../ui';
import { ActivityListRow, activityDate } from './ActivityListRow';
import { TransactionDetailLayout } from './TransactionDetailLayout';
import { compactActivityAmountLabel } from '../activity/activityAmountLabel';
import { utxoActivityAssetIcon } from '../activity/assetIcon';

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
export function UtxoActivityScreen({ authority, selectedNetwork, accountLabel, navigation, onBack, initialHash }: {
  authority: UtxoActivityOwner;
  selectedNetwork: Pick<UtxoNetwork, 'id' | 'name' | 'symbol' | 'decimals' | 'chainId'>;
  accountLabel: string;
  navigation: ShellLeafNavigation;
  onBack(): void;
  initialHash?: string;
}) {
  const { hidden: hideBalances } = useBalancePrivacy();
  const lifetime = useRef({ alive: true, busy: false, action: 0, selected: null as string | null, pending: null as object | null, nodeRequest: null as AbortController | null });
  const controller = useMemo(() => new UtxoActivity(authority, () => AppState.currentState === 'active'), [authority]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [feedback, setFeedback] = useState('');
  const [confirmationOwner, setConfirmationOwner] = useState<UtxoActivityContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [nodeInfo, setNodeInfo] = useState<SentryNodeObservation | 'unavailable' | null>(null);
  const selectTransaction = useCallback((txid: string | null) => {
    lifetime.current.selected = txid;
    lifetime.current.action++;
    lifetime.current.nodeRequest?.abort();
    setNodeInfo(null);
    setDetailsFor(null);
    setSelected(txid); setFeedback(''); setConfirmationOwner(null);
    if (txid) controller.selectDetail(txid); else controller.clearDetail();
  }, [controller]);
  const list = useRef<FlatList<UtxoActivityRow>>(null);
  const summaryChosen = state.rows.find((row) => row.txid === selected);
  const detail = state.detail?.txid === selected ? state.detail : null;
  const chosen = detail?.row ?? summaryChosen;
  const network = state.context?.networkId === selectedNetwork.id ? selectedNetwork : null;
  const openedInitial = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (initialHash && initialHash !== openedInitial.current && network && state.rows.some(row => row.txid === initialHash)) {
      openedInitial.current = initialHash;
      selectTransaction(initialHash);
    }
  }, [initialHash, network, state.rows, selectTransaction]);
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
    return () => { life.alive = false; life.action++; life.selected = null; life.pending = null; life.nodeRequest?.abort(); clear(); controller.dispose(); change.remove(); blur?.remove(); focus?.remove(); };
  }, [controller, selectTransaction]);
  useLayoutEffect(() => navigation.registerBack(() => { if (chosen) selectTransaction(null); else onBack(); return true; }), [navigation, chosen, onBack, selectTransaction]);
  useLayoutEffect(() => navigation.registerLeave((navigate) => { controller.revoke(); navigate(); }), [navigation, controller]);
  useLayoutEffect(() => { navigation.setImmersive(!!chosen); return () => navigation.setImmersive(false); }, [navigation, chosen]);
  const back = () => { if (chosen) selectTransaction(null); else onBack(); };
  const act = async (kind: 'copy' | 'explorer' | 'node') => {
    const life = lifetime.current;
    if (!chosen || !network || !life.alive || life.busy || !controller.isCurrent()) return;
    const readNode = kind === 'node' && detail?.status === 'ready' && state.status === 'ready' ? detail.readSentryNode : undefined;
    if (kind === 'node' && !readNode) return;
    const context = state.context, row = chosen, summary = summaryChosen, action = ++life.action, pending = {};
    life.pending = pending; life.busy = true; setBusy(true); setFeedback('');
    const current = () => life.alive && life.pending === pending && action === life.action && life.selected === row.txid &&
      controller.isCurrent(context) && !!summary && controller.getSnapshot().rows.includes(summary) &&
      (kind !== 'node' || controller.getSnapshot().detail === detail);
    const nodeRequest = readNode ? new AbortController() : null;
    if (nodeRequest) { life.nodeRequest = nodeRequest; setNodeInfo(null); }
    try {
      if (!current()) return;
      if (readNode && nodeRequest) {
        const observation = await readNode(nodeRequest.signal, () => { if (!current()) throw Error('Activity changed'); });
        if (current()) setNodeInfo(observation);
        return;
      }
      if (kind === 'copy') { if (await Clipboard.setStringAsync(row.txid) === false) throw Error(); }
      else if (context) {
        const explorer = authority.getUtxoExplorer(context.networkId).replace(/\/$/, '') + '/';
        await Linking.openURL(new URL(`tx/${row.txid}`, explorer).href);
      }
      if (current()) setFeedback(kind === 'copy' ? 'Transaction ID copied.' : 'Explorer opened.');
    } catch {
      if (current()) {
        if (kind === 'node') setNodeInfo('unavailable');
        else setFeedback(kind === 'copy' ? 'Could not copy the transaction ID.' : 'Could not open the explorer.');
      }
    } finally {
      if (nodeRequest && life.nodeRequest === nodeRequest) life.nodeRequest = null;
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
  const rowDirection = (row: UtxoActivityRow): 'sent' | 'received' | 'self' | 'unknown' => row.hasAssetData
    ? row.assetAmount?.direction ?? 'unknown'
    : row.nativeTransfer?.direction ?? (row.netUnits?.startsWith('-') ? 'sent' : row.netUnits && row.netUnits !== '0' ? 'received' : row.netUnits === '0' ? 'self' : 'unknown');
  const rows = state.rows.filter(row => filter === 'all' || rowDirection(row) === filter || rowDirection(row) === 'self' || rowDirection(row) === 'unknown');
  const dateOf = (row: UtxoActivityRow) => row.block ? activityDate(row.block.timestamp === null ? null : row.block.timestamp * 1000) : { key: 'pending', label: 'Pending', time: '' };
  return <SafeAreaView edges={chosen ? ['top', 'bottom'] : ['top']} style={s.root}>
    <View style={s.header}><Header title={chosen ? 'Transaction details' : 'Activity'} subtitle={network ? `${accountLabel} · ${network.name}` : undefined} onBack={chosen ? back : undefined}
      right={!chosen && network ? <IconButton label="Refresh activity" icon="refresh" disabled={state.status === 'loading'} onPress={() => void refresh()} /> : undefined} /></View>
    {!network || !state.context ? <ScrollView contentContainerStyle={s.content}><Notice title="Activity unavailable" body="Choose an account to view its activity." /></ScrollView> : <View style={s.body}>
      <View aria-hidden={!!chosen} accessibilityElementsHidden={!!chosen} importantForAccessibility={chosen ? 'no-hide-descendants' : 'auto'} pointerEvents={chosen ? 'none' : 'auto'} style={[s.list, chosen && s.obscured]}>
        <FlatList ref={list} testID="watch-activity-list" data={rows} keyExtractor={(row) => row.txid} contentContainerStyle={s.content}
          ListHeaderComponent={<View style={s.section}>
            {(state.status === 'unavailable' || state.status === 'stale') && <Notice title={state.status === 'stale' ? 'Could not refresh activity' : 'Activity unavailable'} body={state.status === 'stale' ? 'Showing previously loaded activity. Try refreshing again.' : 'Activity could not be loaded. Try again.'} tone="amber" />}
            <SegmentedControl label="Activity filter" value={filter}
              options={[{ value: 'all', label: 'All' }, { value: 'sent', label: 'Sent' }, { value: 'received', label: 'Received' }]}
              onChange={value => { setFilter(value); list.current?.scrollToOffset({ offset: 0, animated: false }); }} />
            <View>
              <View role="status" accessibilityLiveRegion="polite">
                {confirmationOwner === state.context && state.status === 'ready' && (
                  <Text style={[styles.muted, s.confirmation]}>Explorer reports a transaction now has confirmations.</Text>
                )}
              </View>
            </View>
            {state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading activity" color={colors.pink} />}
          </View>}
          renderItem={({ item, index }) => {
            const date = dateOf(item), flow = rowDirection(item);
            const fullAmount = item.hasAssetData ? assetQuantity(item) ?? 'Asset activity' : net(item.netUnits);
            const privateAmount = hideBalances && (item.hasAssetData ? assetQuantity(item) !== null : item.netUnits !== null);
            const first = index === 0 || dateOf(rows[index - 1]!).key !== date.key;
            const last = index === rows.length - 1 || dateOf(rows[index + 1]!).key !== date.key;
            return <ActivityListRow testID={`watch-activity-row-${item.txid}`}
              asset={utxoActivityAssetIcon(item, network.chainId)} assetSymbol={item.assetAmount?.symbol}
              first={first} last={last} heading={first ? date.label : undefined} direction={flow}
              title={flow === 'sent' ? 'Sent' : flow === 'received' ? 'Received' : flow === 'self' ? 'Self transfer' : item.hasAssetData ? 'Asset activity' : 'Activity'}
              subtitle={`${network.name} · ${item.block && item.observedConfirmations > 0 ? 'Confirmed' : 'Pending'}`}
              amount={privateAmount ? HIDDEN_BALANCE : compactActivityAmountLabel(fullAmount.replace(/^−/, '-'))} time={date.time}
              label={`${privateAmount ? 'Amount hidden' : fullAmount}, ${status(item)}. ${date.label} ${date.time}. View transaction details`}
              disabled={!!chosen || state.status === 'loading'}
              onPress={() => { if (controller.isCurrent()) selectTransaction(item.txid); }} />;
          }}
          ListEmptyComponent={state.status === 'ready' ? <Notice title={state.rows.length ? "No matching activity" : "No activity yet"} body={state.rows.length ? "Try another filter or load another page." : "There are no transactions to show for this account."} /> : undefined}
          ListFooterComponent={<View style={s.section}>
            {state.status === 'ready' && (state.hasNewer || state.hasMore) && <View style={s.pageActions}>
              {state.hasNewer && <Button title="Newer activity" disabled={!!chosen} variant="secondary" style={s.pageButton} onPress={() => { selectTransaction(null); list.current?.scrollToOffset({ offset: 0, animated: false }); void controller.loadNewer(); }} />}
              {state.hasMore && <Button title="Older activity" disabled={!!chosen} variant="secondary" style={s.pageButton} onPress={() => void controller.loadMore()} />}
            </View>}
            {state.rows.length > 0 && <Text style={styles.muted}>{state.rows.length} transactions shown{state.windowed ? ` · Pages ${state.firstPage}–${state.page}` : ''}</Text>}
          </View>} />
      </View>
      {chosen && <ScrollView testID="watch-activity-detail" style={s.detailOverlay} contentContainerStyle={[s.content, s.detailContent]}>
        <TransactionDetailLayout amount={detailAmount}
          asset={utxoActivityAssetIcon(chosen, network.chainId)} assetSymbol={chosen.assetAmount?.symbol}
          direction={rowDirection(chosen) === 'sent' ? 'Sent' : rowDirection(chosen) === 'received' ? 'Received' : rowDirection(chosen) === 'self' ? 'Self transfer' : 'Activity'}
          status={chosen.block && chosen.observedConfirmations > 0 ? 'Confirmed' : status(chosen)}
          tone={chosen.block && chosen.observedConfirmations > 0 ? 'confirmed' : chosen.block === null ? 'pending' : 'unknown'}
          rows={[
            { label: 'Network', value: network.name },
            { label: 'Date', value: `${dateOf(chosen).label}${dateOf(chosen).time ? `, ${dateOf(chosen).time}` : ''}` },
            { label: 'From', value: detail?.status === 'ready' && detail.from.length ? detail.from.join('\n') : 'Not available' },
            { label: 'To', value: detail?.status === 'ready' && detail.to.length ? detail.to.join('\n') : 'Not available' },
            { label: 'Network fee', value: units(chosen.transactionFeeUnits) },
            { label: 'Transaction ID', value: chosen.txid, actionLabel: 'Copy transaction ID', disabled: busy, onPress: () => { if (!busy) void act('copy'); } },
          ]} onExplorer={() => void act('explorer')} explorerDisabled={busy} />
        {state.status === 'stale' && <Notice title="Previously loaded activity" body="Refresh the list to check this transaction again." tone="amber" />}
        {detail?.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading transaction details" color={colors.pink} />}
        {detail?.status === 'unavailable' && <View style={s.section}>
          <Text style={styles.muted}>Couldn’t load full details.</Text>
          <Button title="Try again" variant="secondary" onPress={() => controller.retryDetail()} />
        </View>}
        <Button title="Details" icon={detailsFor === chosen.txid ? 'chevron-up' : 'chevron-down'} variant="quiet" size="compact" expanded={detailsFor === chosen.txid}
          onPress={() => setDetailsFor(detailsFor === chosen.txid ? null : chosen.txid)} />
        {detailsFor === chosen.txid && <>
        <Text selectable style={s.hash}>{detailAmount}</Text>
        <Text style={styles.muted}>{chosen.hasAssetData ? chosen.assetAmount ? chosen.assetAmount.scope === 'account' ? 'Account asset amount' : 'Asset operation amount' : 'Asset quantity unavailable' : chosen.nativeTransfer ? chosen.nativeTransfer.kind === 'self' ? 'Native self-transfer' : 'Native transfer' : 'Native account change'}</Text>
        <Card style={s.detail}>
          <Text style={s.label}>TRANSACTION ID</Text><Text selectable style={s.hash}>{chosen.txid}</Text>
          {chosen.assetAmount?.assetGuid && <><Text style={s.label}>ASSET ID</Text><Text selectable style={s.hash}>{chosen.assetAmount.assetGuid}</Text></>}
          <Text style={s.label}>ACCOUNT</Text><Text>{accountLabel}</Text>
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
        {detail?.status === 'ready' && detail.readSentryNode && state.status === 'ready' && <>
          <Button title="Look up Sentry node" variant="secondary" disabled={busy} onPress={() => void act('node')} />
          {nodeInfo === 'unavailable' ? <Notice title="Node information unavailable" body="Try the lookup again." tone="amber" /> : nodeInfo && <Card style={s.detail}>
            <Text role="heading">Sentry node information</Text>
            <Text style={styles.muted}>Reported by {nodeInfo.origin}</Text>
            {nodeInfo.node.service && <><Text style={s.label}>NODE SERVICE</Text><Text style={s.hash}>{nodeInfo.node.service}</Text></>}
            <Text style={s.label}>COLLATERAL OUTPOINT</Text>
            <Text selectable style={s.hash}>{nodeInfo.node.collateralOutpoint.txid}:{nodeInfo.node.collateralOutpoint.vout}</Text>
            {nodeInfo.node.nevmAddress && <><Text style={s.label}>REGISTERED NEVM ADDRESS</Text><Text selectable style={s.hash}>{nodeInfo.node.nevmAddress}</Text></>}
          </Card>}
        </>}
        </>}
        {busy && <ActivityIndicator accessibilityLabel="Completing transaction action" color={colors.pink} />}
        {!!feedback && <Text accessibilityLiveRegion="polite" style={styles.muted}>{feedback}</Text>}
      </ScrollView>}
    </View>}
  </SafeAreaView>;
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, header: { paddingHorizontal: 16 }, body: { flex: 1, minHeight: 0 }, list: { flex: 1 }, obscured: { opacity: 0 }, detailOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg },
  pageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, pageButton: { flexGrow: 1 }, content: { paddingHorizontal: 16, paddingBottom: 24, gap: 0 }, detailContent: { gap: 12 }, section: { gap: 8, paddingVertical: 8 }, caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  confirmation: { marginTop: 10 }, hash: { color: colors.text, fontSize: 13, lineHeight: 21 }, amount: { color: colors.text, fontSize: 26, lineHeight: 36 }, detail: { padding: 18, gap: 14 }, label: { color: colors.muted, fontSize: 11, letterSpacing: 1 } });
