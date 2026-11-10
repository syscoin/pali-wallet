import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { formatBalanceDelta, formatBaseUnits } from '../core/amounts';
import type { WatchOnlyAuthority } from '../core/watchOnlyAuthority';
import { getNativeNetwork } from '../custody/networkContext';
import { openTestnetFaucet } from '../custody/testnetFaucet';
import { useNativeCoinQuote } from '../portfolio/useNativeCoinQuote';
import { PortfolioQuote } from './PortfolioQuote';
import { AssetMarketCard } from '../portfolio/AssetMarketCard';
import { NativeSptAssets } from './NativeSptAssets';
import { supportsSptUtxoChain } from '../../../../source/shared/sptInventory';
import { TestnetFaucetCard } from './TestnetFaucetCard';
import { Button, Card, Coin, colors, Header, IconButton, Notice, Row, Screen, styles, Text } from '../ui';
import type { ShellLeafNavigation } from './RealAppShell';

/** Public observation only: this component never receives native custody. */
export function WatchAccountPortfolio({ authority, onAccounts, onExit, onLock, navigation }: {
  authority: WatchOnlyAuthority; onAccounts(): void; onExit(): void; onLock(): void; navigation?: ShellLeafNavigation;
}) {
  const { width, fontScale } = useWindowDimensions();
  const receiveQrSize = width <= 340 ? 176 : 204;
  const stackActions = fontScale >= 1.6 && width < 240 * fontScale;
  const actionStyle = [s.flex, width <= 340 && s.compactAction, stackActions && s.stackedAction];
  const [mode, setMode] = useState<'home' | 'receive' | 'networks' | 'asset'>('home');
  const [feedback, setFeedback] = useState('');
  const assetGeneration = useRef<number | null>(null);
  const receiveReturn = useRef<'home' | 'asset'>('home');
  const [busy, setBusy] = useState(false);
  const [openingFaucet, setOpeningFaucet] = useState(false);
  const [tokenTitle, setTokenTitle] = useState<string | null>(null);
  const tokenBack = useRef<(() => boolean) | null>(null);
  const setTokenBack = useCallback((handler: (() => boolean) | null) => { tokenBack.current = handler; }, []);
  const lifecycle = useRef({ alive: true, action: 0, busy: false });
  const observedGeneration = useRef(authority.getSnapshot().generation);
  const invalidateActions = useCallback(() => { lifecycle.current.action++; lifecycle.current.busy = false; setBusy(false); setOpeningFaucet(false); setFeedback(''); }, []);
  const subscribe = useCallback((listener: () => void) => authority.subscribe((next) => {
    if (observedGeneration.current !== next.generation) { observedGeneration.current = next.generation; assetGeneration.current = null; setMode(value => value === 'asset' ? 'home' : value); invalidateActions(); }
    listener();
  }), [authority, invalidateActions]);
  const getSnapshot = useCallback(() => authority.getSnapshot(), [authority]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { const current = lifecycle.current; current.alive = true; const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') invalidateActions(); }); return () => { current.alive = false; current.action++; subscription.remove(); }; }, [invalidateActions]);
  const handleBack = () => { if (mode === 'home') return tokenBack.current?.() ?? false; setMode(mode === 'receive' && receiveReturn.current === 'asset' && assetGeneration.current === snapshot.generation ? 'asset' : 'home'); invalidateActions(); return true; };
  useLayoutEffect(() => navigation?.registerBack(handleBack));
  useLayoutEffect(() => { navigation?.setImmersive(mode !== 'home'); return () => navigation?.setImmersive(false); }, [navigation, mode]);
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', handleBack); return () => listener.remove(); });
  useEffect(() => {
    const state = authority.getSnapshot();
    if (state.status === 'ready' && state.balance.status === 'unknown') void authority.refresh();
    return () => authority.cancelRefresh();
  }, [authority]);
  const account = snapshot.accounts.find((entry) => entry.id === snapshot.selectedAccountId);
  const network = authority.getNetwork(snapshot.selectedNetworkId);
  const address = account?.addresses[network.id];
  const receiving = mode === 'receive' && snapshot.status === 'ready' && snapshot.capabilities.receive && !!address;
  const current = (generation: number) => lifecycle.current.alive && AppState.currentState === 'active' && authority.getSnapshot().generation === generation && authority.getSnapshot().status === 'ready';
  const publicAction = async (kind: 'copy' | 'share' | 'faucet') => {
    if (!address || !snapshot.capabilities.receive || lifecycle.current.busy || AppState.currentState !== 'active') return;
    if (kind === 'faucet' && AppState.currentState !== 'active') return;
    const generation = snapshot.generation;
    const action = ++lifecycle.current.action;
    lifecycle.current.busy = true; setBusy(true); setOpeningFaucet(kind === 'faucet'); setFeedback('');
    try {
      if (!current(generation)) return;
      if (kind === 'copy') { if (await Clipboard.setStringAsync(address) === false) throw new Error('Copy failed'); }
      else if (kind === 'share') { const result = await Share.share({ title: `${network.name} receive address`, message: `${network.name} (${network.symbol}) address\n${address}` }); if (result?.action !== Share.sharedAction) return; }
      else await openTestnetFaucet(getNativeNetwork(network.id), (url) => Linking.openURL(url), () => {
        if (!current(generation) || action !== lifecycle.current.action || AppState.currentState !== 'active') throw new Error('CANCELLED');
      });
      if (current(generation) && action === lifecycle.current.action) setFeedback(kind === 'faucet' ? 'Faucet opened in your browser. Paste your address there to request test funds.' : `${network.name} address ${kind === 'copy' ? 'copied' : 'shared'}.`);
    } catch { if (current(generation) && action === lifecycle.current.action) setFeedback(kind === 'faucet' ? 'Could not open the faucet. Try again.' : `Could not ${kind} this address. Try again.`); }
    finally { if (action === lifecycle.current.action) { lifecycle.current.busy = false; if (lifecycle.current.alive) { setBusy(false); setOpeningFaucet(false); } } }
  };
  const amount = snapshot.balance.status === 'available' ? formatBaseUnits(snapshot.balance.units, network.decimals) : null;
  const quote = useNativeCoinQuote((mode === 'home' || mode === 'asset') && snapshot.status === 'ready' ? network.id : null, amount);
  const utxo = network.kind === 'utxo';
  const pending = snapshot.balance.status === 'available' && 'kind' in snapshot.balance && snapshot.balance.kind === 'utxo'
    ? snapshot.balance.pendingDeltaUnits : null;
  const pendingAmount = pending === null ? null : formatBalanceDelta(pending, network.decimals);
  const loading = snapshot.balance.status === 'loading';
  const back = () => { invalidateActions(); if (!handleBack()) onExit(); };
  const receive = () => { if (!current(snapshot.generation) || !snapshot.capabilities.receive || !address) return; receiveReturn.current = mode === 'asset' ? 'asset' : 'home'; invalidateActions(); setMode('receive'); };
  const faucetCard = address && network.kind === 'evm' && <TestnetFaucetCard registration={getNativeNetwork(network.id)} busy={busy} opening={openingFaucet} onCopy={mode === 'receive' ? undefined : () => void publicAction('copy')} onOpen={() => void publicAction('faucet')} />;
  const feedbackView = !!feedback && <Text accessibilityRole={feedback.startsWith('Could not ') ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.feedback, feedback.startsWith('Could not ') && { color: colors.red }]}>{feedback}</Text>;
  return <SafeAreaView style={s.safe} edges={navigation && mode === 'home' && !tokenTitle ? ['top'] : ['top', 'bottom']}>
    <Screen key={receiving ? 'receive' : 'portfolio'} scrollResetKey={`${mode}:${tokenTitle ?? ''}`} footerScrollable={receiving} gap={receiving ? 12 : 16}
      footer={receiving ? <View style={[s.actions, stackActions && s.stackedActions]}>
        <Button title="Copy address" icon="copy" size="compact" disabled={busy || !address} onPress={() => void publicAction('copy')} style={actionStyle} />
        <Button title="Share address" icon="share" size="compact" variant="secondary" disabled={busy || !address} onPress={() => void publicAction('share')} style={actionStyle} />
      </View> : undefined}>
      <Header title={mode === 'receive' ? `Receive ${network.symbol}` : mode === 'networks' ? 'Choose network' : mode === 'asset' ? network.name : tokenTitle ?? 'Wallet'}
        subtitle={`${account?.name ?? 'Watch account'} · Watch-only`} onBack={back}
        right={(mode === 'home' || mode === 'asset') && !tokenTitle ? <View style={s.toolbar}>
          <IconButton label={loading ? 'Refreshing…' : 'Refresh'} icon="refresh" disabled={loading} onPress={() => void authority.refresh()} />
          {mode === 'home' && <IconButton label="Accounts" icon="wallet" onPress={onAccounts} />}
        </View> : undefined} />
      {snapshot.status !== 'ready' || !address ? <Notice title="Public account hidden" body="Open your watch account to view its public balance." /> : mode === 'networks' ? <>
        <Text style={styles.muted}>Choose the network for this saved EVM public address.</Text>
        {authority.getAccountNetworks(account).map((choice) => <Card key={choice.id}><Row title={choice.name} subtitle={`${choice.symbol}${choice.testnet ? ' · Test network' : ''}${choice.id === network.id ? ' · Selected' : ''}`} icon="globe" onPress={() => { authority.selectNetwork(choice.id); setMode('home'); setFeedback(''); void authority.refresh(); }} last /></Card>)}
      </> : mode === 'receive' ? <>
        <View style={s.receiveIdentity}><Coin id={utxo ? network.symbol : network.id} fallbackSymbol={utxo ? network.symbol : undefined} size={36} /><Text style={s.name}>{network.name}</Text></View>
        <View style={s.qr} accessible accessibilityRole="image" accessibilityLabel={`QR code for ${network.name} address ${address}`}><QRCode value={address} size={receiveQrSize} quietZone={16} color={colors.bg} backgroundColor="#ffffff" /></View>
        <Text selectable style={s.receiveAddress} accessibilityLabel={`${network.name} address ${address}`}>{address}</Text>
        {feedbackView}
        <Notice title="Check the network" body={`Use ${network.name}${network.testnet ? ' (test network)' : ''} for this address. Check the network in the sending wallet before transferring funds.`} />
        {utxo && <Notice title="One address only" body="Other receive and change addresses in the original wallet are not included." />}
        {faucetCard}
      </> : <>
        {!tokenTitle && <>
          <View style={s.hero}>
            <Coin id={utxo ? network.symbol : network.id} fallbackSymbol={utxo ? network.symbol : undefined} size={46} />
            <Text style={s.label}>{network.name.toUpperCase()}{utxo ? ' CONFIRMED BALANCE' : ' BALANCE'}</Text>
            <Text style={[s.amount, amount !== null && amount.length > 14 && styles.walletBalanceLong, amount !== null && amount.length > 20 && styles.walletBalancePrecise]} accessibilityLabel={amount === null ? loading ? `Loading ${network.name} balance` : 'Balance unavailable' : `${network.name}${utxo ? ' confirmed' : ''} balance ${amount} ${network.symbol}`}>{amount ?? '—'}</Text>
            <Text style={styles.muted}>{amount === null ? loading ? 'Updating…' : 'Balance unavailable' : network.symbol}</Text>
            <PortfolioQuote {...quote} testID="watch-portfolio-quote" />
            {loading && <ActivityIndicator color={colors.pink} />}
            {utxo && <Text style={s.pending} accessibilityLabel={pendingAmount === null ? 'Pending balance change unavailable' : `Pending balance change ${pendingAmount} ${network.symbol}`}>Pending balance change: {pendingAmount === null ? 'Unavailable' : `${pendingAmount} ${network.symbol}`}</Text>}
          </View>
          {snapshot.balance.status === 'error' && <Notice title="Could not load your balance" body="Your address is still available. Refresh to try again." tone="amber" />}
          <Button title="Receive" icon="arrow-down-left" size="compact" onPress={receive} />
          {mode === 'asset' ? <>
            <AssetMarketCard asset={{ kind: 'native', networkId: network.id, registration: network.kind === 'evm' ? getNativeNetwork(network.id) : undefined }} />
            <Card style={s.identity}><Text style={s.label}>{account.name}</Text><Text selectable style={s.address}>{address}</Text></Card>
          </> : <View style={s.assetList}>
            <Text accessibilityRole="header" style={s.assetHeading}>Assets</Text>
            <Card><Row title={network.symbol} subtitle={network.name} icon={<Coin id={utxo ? network.symbol : network.id} fallbackSymbol={utxo ? network.symbol : undefined} size={32} />}
              right={<Text style={s.assetBalance}>{amount ?? '—'} {network.symbol}</Text>}
              onPress={() => { if (current(snapshot.generation)) { assetGeneration.current = snapshot.generation; setMode('asset'); } }} last /></Card>
          </View>}
        </>}
        <View style={mode === 'asset' ? { display: 'none' } : s.assetList} accessibilityElementsHidden={mode === 'asset'} aria-hidden={mode === 'asset'}>
          {network.kind === 'utxo' && supportsSptUtxoChain(network.chainId) && <NativeSptAssets
            key={`${account.id}:${network.id}`} holdings={snapshot.balance.status === 'available' && 'kind' in snapshot.balance && snapshot.balance.kind === 'utxo' ? snapshot.balance.assets ?? null : null}
            loading={loading} onRefresh={() => void authority.refresh()} onModeChange={setTokenTitle} onBackHandlerChange={setTokenBack} onReceive={receive} />}
        </View>
        {mode === 'home' && !tokenTitle && <>
          {faucetCard}
          <Card><Row title="Network" subtitle={network.name} icon="globe" onPress={utxo ? undefined : () => { invalidateActions(); setMode('networks'); }} /><Row title="Hide public account" icon="lock" onPress={onLock} last /></Card>
        </>}
      </>}
      {mode !== 'receive' && feedbackView}
    </Screen>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, toolbar: { flexDirection: 'row' },
  actions: { flexDirection: 'row', gap: 10 }, flex: { flex: 1, minWidth: 0 }, compactAction: { paddingHorizontal: 8 }, stackedActions: { flexDirection: 'column' }, stackedAction: { flex: 0 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 4 }, label: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  amount: { fontSize: 36, lineHeight: 48, textAlign: 'center', alignSelf: 'stretch', flexShrink: 1 }, name: { fontSize: 17, lineHeight: 25 },
  receiveIdentity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  qr: { alignSelf: 'center', backgroundColor: '#fff', padding: 10, borderRadius: 20 }, receiveAddress: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  identity: { padding: 16, gap: 8 }, address: { fontSize: 14, lineHeight: 23 },
  assetList: { gap: 12 }, assetHeading: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  assetBalance: { fontSize: 13, lineHeight: 20, fontWeight: '600', textAlign: 'right', flexShrink: 1, maxWidth: '45%' },
  pending: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  feedback: { color: colors.green, fontSize: 14, lineHeight: 22, textAlign: 'center' },
});
