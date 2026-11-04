import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { formatBaseUnits } from '../core/amounts';
import { getNetwork } from '../core/networks';
import { getWatchNetworks, type WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import { Button, Card, Coin, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';

/** Public observation only: this component never receives native custody. */
export function WatchAccountPortfolio({ authority, onAccounts, onExit, onLock }: {
  authority: WatchOnlyAuthority; onAccounts(): void; onExit(): void; onLock(): void;
}) {
  const subscribe = useCallback((listener: () => void) => authority.subscribe(listener), [authority]);
  const getSnapshot = useCallback(() => authority.getSnapshot(), [authority]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [mode, setMode] = useState<'home' | 'receive' | 'networks'>('home');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const lifecycle = useRef({ alive: true, action: 0, busy: false });
  useEffect(() => { const current = lifecycle.current; current.alive = true; return () => { current.alive = false; current.action++; }; }, []);
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (mode === 'home') return false; setMode('home'); setFeedback(''); lifecycle.current.action++; return true; }); return () => listener.remove(); }, [mode]);
  const account = snapshot.accounts.find((entry) => entry.id === snapshot.selectedAccountId);
  const network = getNetwork(snapshot.selectedNetworkId);
  const address = account?.addresses[network.id];
  const current = (generation: number) => lifecycle.current.alive && authority.getSnapshot().generation === generation && authority.getSnapshot().status === 'ready';
  const publicAction = async (kind: 'copy' | 'share') => {
    if (!address || !snapshot.capabilities.receive || lifecycle.current.busy) return;
    const generation = snapshot.generation;
    const action = ++lifecycle.current.action;
    lifecycle.current.busy = true; setBusy(true); setFeedback('');
    try {
      if (!current(generation)) return;
      if (kind === 'copy') { if (await Clipboard.setStringAsync(address) === false) throw new Error('Copy failed'); }
      else { const result = await Share.share({ title: `${network.name} receive address`, message: `${network.name} (${network.symbol}) address\n${address}` }); if (result?.action !== Share.sharedAction) return; }
      if (current(generation) && action === lifecycle.current.action) setFeedback(`${network.name} address ${kind === 'copy' ? 'copied' : 'shared'}.`);
    } catch { if (current(generation) && action === lifecycle.current.action) setFeedback(`Could not ${kind} this address. Try again.`); }
    finally { lifecycle.current.busy = false; if (lifecycle.current.alive) setBusy(false); }
  };
  const amount = snapshot.balance.status === 'available' ? formatBaseUnits(snapshot.balance.units, network.decimals) : null;
  const loading = snapshot.balance.status === 'loading';
  const back = () => { setFeedback(''); lifecycle.current.action++; if (mode !== 'home') setMode('home'); else onExit(); };
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}><Screen footer={mode === 'receive' ? <View style={s.actions}><Button title="Copy address" icon="copy" disabled={busy || !address} onPress={() => void publicAction('copy')} style={s.flex} /><Button title="Share address" icon="share" variant="secondary" disabled={busy || !address} onPress={() => void publicAction('share')} style={s.flex} /></View> : undefined}>
    <Header title={mode === 'receive' ? `Receive ${network.symbol}` : mode === 'networks' ? 'Choose network' : 'Wallet'} subtitle={`${account?.name ?? 'Watch account'} · Watch-only`} onBack={back} right={mode === 'home' ? <Button title="Accounts" variant="quiet" onPress={onAccounts} /> : undefined} />
    {snapshot.status !== 'ready' || !address ? <Notice title="Public account hidden" body="Open your watch account to view its public balance." /> : mode === 'networks' ? <>
      <Text style={styles.muted}>Choose the network for this saved EVM public address.</Text>
      {getWatchNetworks(account).map((choice) => <Card key={choice.id}><Row title={choice.name} subtitle={`${choice.symbol}${choice.testnet ? ' · Test network' : ''}${choice.id === network.id ? ' · Selected' : ''}`} icon="globe" onPress={() => { authority.selectNetwork(choice.id); setMode('home'); setFeedback(''); void authority.refresh(); }} last /></Card>)}
    </> : mode === 'receive' ? <>
      <View style={s.hero}><Coin id={network.id} size={48} /><Text style={s.name}>{network.name}</Text><Text style={styles.muted}>{account.name}</Text></View>
      <View style={s.qr} accessible accessibilityRole="image" accessibilityLabel={`QR code for ${network.name} address ${address}`}><QRCode value={address} size={204} quietZone={16} color={colors.bg} backgroundColor="#ffffff" /></View>
      <Text selectable style={s.receiveAddress} accessibilityLabel={`${network.name} address ${address}`}>{address}</Text>
      <Notice title="Check the network" body={`Use ${network.name}${network.testnet ? ' (test network)' : ''} for this address. Check the network in the sending wallet before transferring funds.`} />
    </> : <>
      <View style={s.hero}><Coin id={network.id} size={46} /><Text style={s.label}>{network.name.toUpperCase()} BALANCE</Text><Text style={s.amount} accessibilityLabel={amount === null ? loading ? `Loading ${network.name} balance` : 'Balance unavailable' : `${network.name} balance ${amount} ${network.symbol}`}>{amount ?? '—'}</Text><Text style={styles.muted}>{amount === null ? loading ? 'Updating…' : 'Balance unavailable' : network.symbol}</Text>{loading && <ActivityIndicator color={colors.pink} />}</View>
      <Notice title="You’re watching this account" body="This public address can receive funds. Spending and recovery require the wallet that holds its keys." />
      {snapshot.balance.status === 'error' && <Notice title="Could not load your balance" body="Your address is still available. Refresh to try again." tone="amber" />}
      <View style={s.actions}><Button title="Receive" icon="arrow-down-left" onPress={() => { setFeedback(''); setMode('receive'); }} style={s.flex} /><Button title={loading ? 'Refreshing…' : 'Refresh'} icon="refresh" disabled={loading} onPress={() => void authority.refresh()} variant="secondary" style={s.flex} /></View>
      <Text style={s.privacy}>Refreshing shares this public address with the {network.name} RPC provider.</Text>
      <Card style={s.identity}><Text style={s.label}>{account.name}</Text><Text selectable style={s.address}>{address}</Text></Card>
      <Card><Row title="Network" subtitle={network.name} icon="globe" onPress={() => setMode('networks')} /><Row title="Hide public account" icon="lock" onPress={onLock} last /></Card>
      <Text style={s.privacy}>EVM public address only · No recovery phrase or extended public key is stored.</Text>
    </>}
    {!!feedback && <Text accessibilityLiveRegion="polite" style={s.feedback}>{feedback}</Text>}
  </Screen></SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, flex: { flex: 1, minWidth: 120 }, hero: { alignItems: 'center', gap: 10, paddingVertical: 16 }, label: { color: colors.muted, fontSize: 12, lineHeight: 20 }, amount: { fontSize: 36, lineHeight: 48, textAlign: 'center', alignSelf: 'stretch', flexShrink: 1 }, name: { fontSize: 20, lineHeight: 28 }, qr: { alignSelf: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 20 }, receiveAddress: { fontSize: 15, lineHeight: 25, textAlign: 'center' }, identity: { padding: 18, gap: 10 }, address: { fontSize: 14, lineHeight: 23 }, privacy: { color: colors.muted, fontSize: 12, lineHeight: 20 }, feedback: { color: colors.green, fontSize: 14, lineHeight: 22, textAlign: 'center' } });
