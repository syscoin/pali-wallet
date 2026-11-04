import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { getNativeNetwork, nativeSigningEnabled } from '../custody/networkContext';
import { getTestnetFaucet, openTestnetFaucet } from '../custody/testnetFaucet';
import { getNetwork } from '../core/networks';
import { formatBaseUnits } from '../core/amounts';
import type { BalanceReader } from '../core/watchOnlyAuthority';
import { createBalanceReader } from '../platformRpc';
import { NativePortfolioController } from '../portfolio/nativePortfolio';
import type { NativeTokenView } from '../portfolio/nativeTokens';
import { NativeTokens } from './NativeTokens';
import { TestnetFaucetCard } from './TestnetFaucetCard';
import type { Erc20Metadata } from '../../../../source/shared/erc20';
import type { NativePortfolioAccount, NativePortfolioSnapshot, PublicCustodySource } from '../portfolio/nativePortfolio';
import { Button, Card, Coin, colors, Header, Notice, Row, Screen, styles, Text } from '../ui';

type Props = {
  source: PublicCustodySource;
  onExit(): void;
  onLock(): void;
  onViewRecovery(): void;
  onSecurity?(): void;
  onSend?(): void;
  onSendToken?(token: Erc20Metadata): void;
  reader?: BalanceReader;
  accountLabel?: string;
  onManageAccounts?(): void;
  onManageNetworks?(): void;
  onActivity?(): void;
  tokenView?: NativeTokenView;
};
type Feedback = { scope: string; text: string; failed?: boolean } | null;
const scopeOf = (account: NativePortfolioAccount) => `${account.revision}:${account.network}:${account.address}`;

/** Only the custody authority's public account projection reaches this screen. */
export function NativePortfolio({ source, onExit, onLock, onViewRecovery, onSecurity, onSend, onSendToken, reader, accountLabel = 'Account 1', onManageAccounts, onManageNetworks, onActivity, tokenView }: Props) {
  const balanceReader = useMemo(() => reader ?? createBalanceReader(), [reader]);
  const model = useMemo(() => new NativePortfolioController(source, balanceReader), [source, balanceReader]);
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useLayoutEffect(() => model.connect(), [model]);
  const scope = snapshot.account ? scopeOf(snapshot.account) : 'unavailable';
  return <NativePortfolioContent key={scope} model={model} snapshot={snapshot} onExit={onExit} onLock={onLock} onViewRecovery={onViewRecovery} onSecurity={onSecurity} onSend={onSend} onSendToken={onSendToken} accountLabel={accountLabel} onManageAccounts={onManageAccounts} onManageNetworks={onManageNetworks} onActivity={onActivity} tokenView={tokenView} />;
}

function NativePortfolioContent({ model, snapshot, onExit, onLock, onViewRecovery, onSecurity, onSend, onSendToken, accountLabel, onManageAccounts, onManageNetworks, onActivity, tokenView }: {
  model: NativePortfolioController; snapshot: NativePortfolioSnapshot;
  onExit(): void; onLock(): void; onViewRecovery(): void; onSecurity?(): void; onSend?(): void; onSendToken?(token: Erc20Metadata): void; accountLabel: string; onManageAccounts?(): void; onManageNetworks?(): void; onActivity?(): void; tokenView?: NativeTokenView;
}) {
  const [receiveScope, setReceiveScope] = useState<string | null>(null);
  const [tokenTitle, setTokenTitle] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingAction, setPendingAction] = useState<'copy' | 'share' | 'faucet' | null>(null);
  const lifecycle = useRef({ alive: false, epoch: 0, busy: false });
  const tokenBack = useRef<(() => boolean) | null>(null);
  const setTokenBack = useCallback((handler: (() => boolean) | null) => { tokenBack.current = handler; }, []);
  const account = snapshot.account;
  const network = getNetwork(account?.network ?? 'ethereum');
  const networkName = network.name;
  const symbol = network.symbol;
  const scope = account ? scopeOf(account) : null;
  const receiving = !!scope && receiveScope === scope;
  const loading = snapshot.status === 'loading';
  const canSend = !!account && nativeSigningEnabled(account.network) && !!onSend;
  const faucet = account ? getTestnetFaucet(getNativeNetwork(account.network)) : null;

  const invalidateActions = useCallback(() => {
    lifecycle.current.epoch++; lifecycle.current.busy = false;
    setPendingAction(null); setFeedback(null);
  }, []);
  useLayoutEffect(() => {
    const current = lifecycle.current;
    current.alive = true;
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') invalidateActions(); });
    return () => { current.alive = false; current.epoch++; current.busy = false; subscription.remove(); };
  }, [invalidateActions]);
  useLayoutEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!receiving) return false;
      setReceiveScope(null); invalidateActions(); return true;
    });
    return () => back.remove();
  }, [receiving, invalidateActions]);

  const back = () => { if (receiving) { setReceiveScope(null); invalidateActions(); } else if (!tokenBack.current?.()) onExit(); };
  const publicAction = async (kind: 'copy' | 'share' | 'faucet') => {
    const current = account;
    if (!current || !model.isCurrent(current) || lifecycle.current.busy) return;
    if (kind === 'faucet' && AppState.currentState !== 'active') return;
    lifecycle.current.busy = true;
    const request = ++lifecycle.current.epoch;
    setPendingAction(kind); setFeedback(null);
    try {
      if (!model.isCurrent(current)) return;
      let completed = true;
      if (kind === 'copy') {
        const copied = await Clipboard.setStringAsync(current.address);
        if (copied === false) throw new Error('COPY_FAILED');
      }
      else if (kind === 'share') {
        const result = await Share.share({ title: `${networkName} receive address`, message: `${networkName} (${symbol}) address\n${current.address}` });
        completed = !result || result.action === Share.sharedAction;
      } else {
        await openTestnetFaucet(getNativeNetwork(current.network), (url) => Linking.openURL(url), () => {
          if (!lifecycle.current.alive || lifecycle.current.epoch !== request || AppState.currentState !== 'active' || !model.isCurrent(current))
            throw new Error('CANCELLED');
        });
      }
      if (lifecycle.current.alive && lifecycle.current.epoch === request && model.isCurrent(current) && completed)
        setFeedback({ scope: scopeOf(current), text: kind === 'copy' ? `${networkName} address copied.` : kind === 'share' ? `${networkName} address shared.` : 'Faucet opened in your browser. Paste your address there to request test funds.' });
    } catch {
      if (lifecycle.current.alive && lifecycle.current.epoch === request && model.isCurrent(current))
        setFeedback({ scope: scopeOf(current), text: kind === 'copy' ? 'Could not copy this address. Try again.' : kind === 'share' ? 'Could not share this address. Try again.' : 'Could not open the faucet. Try again.', failed: true });
    } finally {
      if (lifecycle.current.alive && lifecycle.current.epoch === request) { lifecycle.current.busy = false; setPendingAction(null); }
    }
  };

  const amount = snapshot.status === 'available' && snapshot.units !== null ? formatBaseUnits(snapshot.units, network.decimals) : null;
  const statusText = loading ? `Loading ${networkName} balance…` : snapshot.status === 'error' ? 'Balance unavailable' : 'Balance not loaded';
  const currentFeedback = feedback?.scope === scope ? feedback : null;
  const faucetCard = faucet && account && <TestnetFaucetCard registration={getNativeNetwork(account.network)} busy={!!pendingAction} opening={pendingAction === 'faucet'} onCopy={receiving ? undefined : () => void publicAction('copy')} onOpen={() => void publicAction('faucet')} />;
  const actions = receiving ? <View style={s.actions}>
    <Button title="Copy address" icon="copy" style={s.flex} disabled={!account || !!pendingAction} onPress={() => publicAction('copy')} testID="native-receive-copy" />
    <Button title="Share address" icon="share" variant="secondary" style={s.flex} disabled={!account || !!pendingAction} onPress={() => publicAction('share')} testID="native-receive-share" />
  </View> : undefined;

  return <SafeAreaView edges={['top', 'bottom']} style={s.safeArea}>
    <Screen footer={actions}>
      <Header title={receiving ? `Receive ${symbol}` : tokenTitle ?? 'Wallet'} subtitle={`${accountLabel} · ${networkName}${network.testnet ? ' · Test network' : ''}`} onBack={back} right={!receiving && !tokenTitle && onManageAccounts ? <Button title="Accounts" variant="quiet" onPress={onManageAccounts} /> : undefined} />
      {!account ? <Notice title="Wallet locked" body="Unlock your wallet to view its account." /> : receiving ? <>
        <View style={s.identity}><Coin id={network.id} size={48} /><Text style={s.network}>{networkName}</Text><Text style={styles.muted}>{accountLabel}</Text></View>
        <View style={s.qr} accessible accessibilityRole="image" accessibilityLabel={`QR code for ${networkName} address ${account.address}`} testID="native-receive-qr">
          <QRCode value={account.address} size={204} quietZone={16} backgroundColor="#ffffff" color={colors.bg} ecl="M" />
        </View>
        <Text selectable style={s.receiveAddress} accessibilityLabel={`${networkName} address ${account.address}`} testID="native-receive-address">{account.address}</Text>
        <Notice title="Check the network" body={`Use ${networkName}${network.testnet ? ' (test network)' : ''} for this address. Check the network in the sending wallet before transferring funds.`} />
        {faucetCard}
      </> : <>
        {!tokenTitle && <>
        <View style={s.hero}>
          <Coin id={network.id} size={46} />
          <Text style={s.label}>{networkName.toUpperCase()} BALANCE</Text>
          <Text style={[s.amount, amount !== null && amount.length > 14 && s.longAmount]} accessibilityLabel={amount === null ? statusText : `${networkName} balance ${amount} ${symbol}`} testID="native-portfolio-balance">{amount ?? '—'}</Text>
          <Text style={s.unit}>{amount === null ? statusText : symbol}</Text>
          {loading && <ActivityIndicator color={colors.pink} accessibilityLabel={`Loading ${networkName} balance`} />}
          {snapshot.status === 'available' && snapshot.updatedAt !== null && <Text style={s.freshness}>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>
        {snapshot.status === 'error' && <Notice title="Could not load your balance" body={`Your ${networkName} address is still available. Refresh to try again.`} tone="amber" />}
        {!canSend && <Notice title={network.testnet ? 'Test network · Balance and receive only' : 'Balance and receive only'} body="Sending is not available on this network yet." />}
        <View style={s.actions}>
          {canSend && <Button title="Send" icon="arrow-up-right" style={s.flex} onPress={() => { if (account && model.isCurrent(account)) onSend?.(); }} />}
          <Button title="Receive" variant={canSend ? 'secondary' : 'primary'} icon="arrow-down-left" style={s.flex} testID="native-portfolio-receive" onPress={() => { if (account && model.isCurrent(account)) { invalidateActions(); setReceiveScope(scopeOf(account)); } }} />
          {!canSend && <Button title={loading ? 'Refreshing…' : 'Refresh'} icon="refresh" variant="secondary" style={s.flex} disabled={loading} onPress={() => model.refresh()} testID="native-portfolio-refresh" />}
        </View>
        {canSend && <Button title={loading ? 'Refreshing…' : 'Refresh'} icon="refresh" variant="quiet" disabled={loading} onPress={() => model.refresh()} testID="native-portfolio-refresh" />}
        <Text style={s.privacy}>Refreshing shares this public address with the {networkName} RPC provider.</Text>
        <Card style={s.accountCard}><Text style={s.label}>{accountLabel.toUpperCase()} · {networkName.toUpperCase()}</Text><Text selectable style={s.address}>{account.address}</Text></Card>
        {faucetCard}
        </>}
        {tokenView && <NativeTokens controller={tokenView} onBackHandlerChange={setTokenBack} onModeChange={setTokenTitle}
          onSend={account?.network === 'ethereum' && onSendToken ? (token) => { if (model.isCurrent(account)) onSendToken(token); } : undefined}
          onReceive={() => { if (account && model.isCurrent(account)) { invalidateActions(); setReceiveScope(scopeOf(account)); } }} />}
        {!tokenTitle && <Card style={s.tools}>{onActivity && <Row title="Activity" subtitle="Transactions and token transfer events" icon="clock" onPress={onActivity} />}{onManageNetworks && <Row title="Network" subtitle={`${networkName}${network.testnet ? ' · Test network' : ''}`} icon="globe" onPress={onManageNetworks} />}<Row title={onSecurity ? "Security & backups" : "View recovery phrase"} subtitle={onSecurity ? "Recovery phrase and account key" : "Confirm your password to continue"} icon="shield" onPress={onSecurity ?? onViewRecovery} /><Row title="Lock wallet" icon="lock" onPress={onLock} last /></Card>}
      </>}
      {currentFeedback && <Text accessibilityRole={currentFeedback.failed ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.feedback, currentFeedback.failed && { color: colors.red }]}>{currentFeedback.text}</Text>}
      <Text style={s.buildLabel}>Development build · Use a test wallet</Text>
    </Screen>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 }, actions: { flexDirection: 'row', gap: 11 },
  hero: { alignItems: 'center', gap: 9, paddingTop: 8, paddingBottom: 12 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 17, fontWeight: '600', letterSpacing: 1 },
  amount: { fontSize: 36, lineHeight: 46, fontWeight: '600', textAlign: 'center', letterSpacing: -1.1, alignSelf: 'stretch', flexShrink: 1 },
  longAmount: { fontSize: 24, lineHeight: 34, letterSpacing: -0.4 },
  unit: { color: colors.muted, fontSize: 15, lineHeight: 22 }, freshness: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  accountCard: { padding: 18, gap: 10 }, address: { color: colors.text, fontSize: 14, lineHeight: 23 },
  tools: { overflow: 'hidden' }, identity: { alignItems: 'center', gap: 8 }, network: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  qr: { alignSelf: 'center', backgroundColor: '#ffffff', padding: 10, borderRadius: 20, maxWidth: '100%' },
  receiveAddress: { color: colors.text, fontSize: 15, lineHeight: 25, textAlign: 'center', marginHorizontal: 4 },
  feedback: { color: colors.green, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  buildLabel: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
});
