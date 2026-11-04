import React, { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { formatBaseUnits } from '../core/amounts';
import { UtxoWatchActivity, type UtxoActivityReader, type UtxoActivityRow } from '../core/utxoActivity';
import { getUtxoNetwork } from '../core/utxoNetworks';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import type { ShellLeafNavigation } from './RealAppShell';
import { Button, Card, colors, Header, Notice, styles, Text } from '../ui';

function signed(units: string, symbol: string): string {
  const negative = units.startsWith('-');
  return `${negative ? '−' : units === '0' ? '' : '+'}${formatBaseUnits(negative ? units.slice(1) : units, 8)} ${symbol}`;
}
/** Active-tab public history only. No request occurs until the user presses Load. */
export function WatchActivity({ authority, reader, navigation, onBack }: {
  authority: WatchOnlyAuthority; reader: UtxoActivityReader; navigation: ShellLeafNavigation; onBack(): void;
}) {
  const lifetime = useRef({ alive: true, busy: false, action: 0 });
  const controller = useMemo(() => new UtxoWatchActivity(authority, reader, () => AppState.currentState === 'active'), [authority, reader]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<UtxoActivityRow>>(null);
  const scrollOffset = useRef(0);
  const chosen = state.rows.find((row) => row.txid === selected);
  const network = state.context ? getUtxoNetwork(state.context.networkId) : null;
  const account = authority.getSnapshot().accounts.find((row) => row.id === state.context?.accountId);
  useLayoutEffect(() => {
    const life = lifetime.current; life.alive = true;
    const clear = controller.subscribe(() => { if (controller.getSnapshot().status === 'consent') { setSelected(null); setFeedback(''); setBusy(false); life.busy = false; scrollOffset.current = 0; life.action++; } });
    controller.activate();
    const revoke = () => { lifetime.current.action++; lifetime.current.busy = false; setFeedback(''); setBusy(false); controller.revoke(); };
    const change = AppState.addEventListener('change', (value) => { if (value !== 'active') revoke(); });
    const blur = AppState.addEventListener('blur', () => { controller.setFocused(false); revoke(); });
    const focus = AppState.addEventListener('focus', () => { controller.setFocused(true); });
    return () => { life.alive = false; life.action++; clear(); controller.dispose(); change.remove(); blur.remove(); focus.remove(); };
  }, [controller]);
  useLayoutEffect(() => navigation.registerBack(() => { if (chosen) setSelected(null); else onBack(); return true; }), [navigation, chosen, onBack]);
  useLayoutEffect(() => navigation.registerLeave((navigate) => { controller.revoke(); navigate(); }), [navigation, controller]);
  useLayoutEffect(() => { navigation.setImmersive(!!chosen); return () => navigation.setImmersive(false); }, [navigation, chosen]);
  useLayoutEffect(() => { if (!chosen) list.current?.scrollToOffset({ offset: scrollOffset.current, animated: false }); }, [chosen]);
  const back = () => { if (chosen) setSelected(null); else onBack(); };
  const act = async (kind: 'copy' | 'explorer') => {
    if (!chosen || !network || lifetime.current.busy || !controller.isCurrent()) return;
    const context = state.context, row = chosen, action = ++lifetime.current.action;
    const current = () => action === lifetime.current.action && controller.isCurrent(context) && controller.getSnapshot().rows.includes(row);
    lifetime.current.busy = true; setBusy(true); setFeedback('');
    try {
      if (!current()) return;
      if (kind === 'copy') { if (await Clipboard.setStringAsync(row.txid) === false) throw Error(); }
      else await Linking.openURL(`${network.endpoint}/tx/${row.txid}`);
      if (current()) setFeedback(kind === 'copy' ? 'Transaction ID copied.' : 'Explorer opened.');
    } catch { if (current()) setFeedback(kind === 'copy' ? 'Could not copy the transaction ID.' : 'Could not open the explorer.'); }
    finally { if (current()) { lifetime.current.busy = false; setBusy(false); } }
  };
  const refresh = () => { setSelected(null); setFeedback(''); scrollOffset.current = 0; list.current?.scrollToOffset({ offset: 0, animated: false }); void controller.refresh(); };
  return <SafeAreaView edges={chosen ? ['top', 'bottom'] : ['top']} style={s.root}>
    <View style={s.header}><Header title={chosen ? 'Transaction details' : 'Confirmed activity'} subtitle={`${account?.name ?? 'Watch account'} · ${network?.name ?? 'Public account'}`} onBack={back} /></View>
    {!network || !state.context ? <ScrollView contentContainerStyle={s.content}><Notice title="Public activity hidden" body="Open a supported watch account to view its activity." /></ScrollView> : <>
      <View style={[s.list, chosen && s.hidden]}>
        <FlatList ref={list} testID="watch-activity-list" onScroll={(event) => { if (!chosen) scrollOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} data={state.rows} keyExtractor={(row) => row.txid} contentContainerStyle={s.content}
          ListHeaderComponent={<View style={s.section}>
            <Notice title="One address · Confirmed transactions only" body="Other receive and change addresses in the original wallet are not included. Pending balance change is on Wallet. This is indexed activity, not a complete wallet history or proof of payment." />
            <Text selectable style={s.hash}>{state.context.address}</Text>
            <Text style={styles.muted}>Loading shares this address and your IP address with {network.endpoint.replace('https://', '')}. Transaction details use the same provider.</Text>
            {state.status === 'consent' ? <Button title="Load confirmed activity" onPress={() => void controller.load()} /> : <>
              {state.anchor && <Text style={styles.muted}>Observed at block {state.anchor.height}. Confirmation counts refer to this snapshot.</Text>}
              {(state.status === 'unavailable' || state.status === 'stale') && <Notice title={state.status === 'stale' ? 'Saved view is out of date' : 'Activity unavailable'} body={state.status === 'stale' ? 'The last request could not be verified. These previously loaded rows may be outdated. Refresh to start a new snapshot.' : 'No activity result could be verified. Try again; this does not mean there are no transactions.'} tone="amber" />}
              <Button title={state.status === 'unavailable' ? 'Try loading again' : 'Refresh confirmed activity'} variant="secondary" disabled={state.status === 'loading'} onPress={refresh} />
            </>}
            {state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading confirmed activity" color={colors.pink} />}
          </View>}
          renderItem={({ item }) => <View style={s.row}><Button title={`Net change ${signed(item.netUnits, network.symbol)}`} variant="quiet" disabled={state.status === 'loading'} onPress={() => { if (controller.isCurrent()) { setSelected(item.txid); setFeedback(''); } }} />
            <Text style={styles.muted}>{item.observedConfirmations} confirmation{item.observedConfirmations === 1 ? '' : 's'} at block {state.anchor?.height}</Text>
            <Text style={s.hash}>{item.txid.slice(0, 12)}…{item.txid.slice(-8)}</Text>
            {item.hasUnsupportedAssetData && <Text style={styles.muted}>Additional asset activity is not shown.</Text>}
          </View>}
          ListEmptyComponent={state.status === 'ready' ? <Notice title="No confirmed activity in the loaded range" body="The provider returned no confirmed transactions in this snapshot. Other addresses and pending transactions are not included." /> : undefined}
          ListFooterComponent={<View style={s.section}>
            {state.status === 'ready' && state.hasMore && <Button title="Load older confirmed activity" variant="secondary" onPress={() => void controller.loadMore()} />}
            {state.limitReached && <Notice title="100-transaction display limit" body="Older indexed activity may exist. This view does not establish a complete history." />}
            {state.rows.length > 0 && <Text style={styles.muted}>{state.rows.length} loaded transaction{state.rows.length === 1 ? '' : 's'}. Amounts are changes to this address, not your entire wallet.</Text>}
          </View>} />
      </View>
      {chosen && <ScrollView contentContainerStyle={s.content}>
        <Text style={s.amount}>{signed(chosen.netUnits, network.symbol)}</Text><Text style={styles.muted}>Net change to this address</Text>
        {state.status === 'stale' && <Notice title="Previously loaded snapshot" body="Refresh the list to verify a new snapshot. This transaction may have changed." tone="amber" />}
        <Card style={s.detail}>
          <Text style={s.label}>TRANSACTION ID</Text><Text selectable style={s.hash}>{chosen.txid}</Text>
          <Text style={s.label}>WATCHED ADDRESS</Text><Text selectable style={s.hash}>{state.context.address}</Text>
          <Text>Received by this address: {formatBaseUnits(chosen.receivedUnits, 8)} {network.symbol}</Text>
          <Text>Spent from this address: {formatBaseUnits(chosen.spentUnits, 8)} {network.symbol}</Text>
          <Text>Whole transaction fee: {chosen.transactionFeeUnits === null ? 'Not applicable (coinbase)' : `${formatBaseUnits(chosen.transactionFeeUnits, 8)} ${network.symbol}`}</Text>
          <Text style={styles.muted}>The fee is for the whole transaction and may be paid from several inputs. It is already reflected in the address change where applicable.</Text>
          <Text>Block {chosen.block.height} · {chosen.observedConfirmations} confirmations at block {state.anchor?.height}</Text>
          {chosen.block.timestamp !== null && <Text>Block time: {new Date(chosen.block.timestamp * 1000).toISOString()}</Text>}
        </Card>
        {chosen.hasUnsupportedAssetData && <Notice title="Additional asset activity" body="This transaction also contains asset activity that is not shown. The amounts above are native coin only." />}
        <Button title="Copy transaction ID" variant="secondary" disabled={busy} onPress={() => void act('copy')} />
        <Text style={styles.muted}>Opening the explorer shares your transaction interest and IP address with {network.endpoint.replace('https://', '')} in your browser.</Text>
        <Button title="Open transaction in explorer" variant="quiet" disabled={busy} onPress={() => void act('explorer')} />
        {!!feedback && <Text accessibilityLiveRegion="polite" style={styles.muted}>{feedback}</Text>}
      </ScrollView>}
    </>}
  </SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, header: { paddingHorizontal: 24 }, list: { flex: 1 }, hidden: { display: 'none' },
  content: { paddingHorizontal: 24, paddingBottom: 28, gap: 16 }, section: { gap: 14, paddingVertical: 12 }, row: { gap: 8, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  hash: { color: colors.text, fontSize: 13, lineHeight: 21 }, amount: { color: colors.text, fontSize: 26, lineHeight: 36 }, detail: { padding: 18, gap: 14 }, label: { color: colors.muted, fontSize: 11, letterSpacing: 1 } });
